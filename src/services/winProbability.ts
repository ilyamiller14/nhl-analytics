/**
 * Win Probability Calculator
 *
 * Estimates probability of winning based on:
 * - Current score
 * - Time remaining
 * - Shot differential
 * - Momentum
 * - xG differential
 */

export interface GameState {
  period: number;
  timeRemaining: number; // Total seconds remaining in game
  homeScore: number;
  awayScore: number;
  homeShotsFor: number;
  awayShotsFor: number;
  homeXG: number;
  awayXG: number;
  situation: 'even' | 'home-pp' | 'away-pp'; // Current game situation
}

export interface WinProbability {
  homeWinProb: number; // 0-1
  awayWinProb: number; // 0-1
  tieProb: number; // 0-1 (chance of going to OT/SO)
  confidence: number; // 0-1 (how confident the model is)
  factors: {
    scoreImpact: number;
    timeImpact: number;
    shotImpact: number;
    xgImpact: number;
    situationImpact: number;
  };
}

/**
 * Calculate win probability based on game state
 *
 * Uses a simplified model based on:
 * 1. Score differential (most important)
 * 2. Time remaining (affects score impact)
 * 3. Shot/xG differential (possession quality)
 * 4. Game situation (PP/PK)
 */
export function calculateWinProbability(state: GameState): WinProbability {
  const {
    timeRemaining,
    homeScore,
    awayScore,
    homeShotsFor,
    awayShotsFor,
    homeXG,
    awayXG,
    situation,
  } = state;

  // Score differential
  const scoreDiff = homeScore - awayScore;

  // Shot and xG differentials
  const shotDiff = homeShotsFor - awayShotsFor;
  const xgDiff = homeXG - awayXG;

  // Time factor (0-1, where 1 = game just started, 0 = game ending)
  const totalGameTime = 3600; // 60 minutes
  const timeFactor = timeRemaining / totalGameTime;

  // === Calculate impact factors ===

  // 1. Score impact (sigmoid function)
  // When time is low, score matters more
  const scoreWeight = 1 - timeFactor * 0.5; // Weight increases as time decreases
  const scoreImpact = sigmoid(scoreDiff * scoreWeight * 2);

  // 2. Time impact
  // How much time is left for comeback potential
  const timeImpact = timeFactor;

  // 3. Shot differential impact
  // More shots = better possession
  const shotImpact = sigmoid(shotDiff / 10);

  // 4. xG differential impact
  // Quality of chances
  const xgImpact = sigmoid(xgDiff / 2);

  // 5. Situation impact (PP advantage)
  let situationImpact = 0;
  if (situation === 'home-pp') situationImpact = 0.1;
  else if (situation === 'away-pp') situationImpact = -0.1;

  // === Combine factors ===

  // Score is most important, especially late in game
  let homeAdvantage = scoreImpact * 0.6;

  // Possession metrics matter more early in game
  homeAdvantage += shotImpact * 0.15 * timeFactor;
  homeAdvantage += xgImpact * 0.2 * timeFactor;
  homeAdvantage += situationImpact * 0.05;

  // Baseline (50-50 when tied with lots of time)
  homeAdvantage += 0.5;

  // Clamp to [0, 1]
  const homeWinProb = Math.max(0.01, Math.min(0.99, homeAdvantage));
  const awayWinProb = 1 - homeWinProb;

  // Tie probability (chance of OT/SO)
  // Higher when score is close and time is low
  let tieProb = 0;
  if (Math.abs(scoreDiff) <= 1 && timeRemaining < 600) {
    // Last 10 minutes with close score
    tieProb = 0.1 * (1 - timeFactor) * (1 - Math.abs(scoreDiff));
  }

  // Confidence (how certain we are)
  // Low confidence early, high confidence late
  // Low confidence when close score, high when blowout
  const scoreConfidence = Math.min(Math.abs(scoreDiff) / 3, 1);
  const timeConfidence = 1 - timeFactor;
  const confidence = (scoreConfidence + timeConfidence) / 2;

  return {
    homeWinProb: parseFloat(homeWinProb.toFixed(3)),
    awayWinProb: parseFloat(awayWinProb.toFixed(3)),
    tieProb: parseFloat(tieProb.toFixed(3)),
    confidence: parseFloat(confidence.toFixed(2)),
    factors: {
      scoreImpact: parseFloat(scoreImpact.toFixed(3)),
      timeImpact: parseFloat(timeImpact.toFixed(3)),
      shotImpact: parseFloat(shotImpact.toFixed(3)),
      xgImpact: parseFloat(xgImpact.toFixed(3)),
      situationImpact: parseFloat(situationImpact.toFixed(3)),
    },
  };
}

/**
 * Sigmoid function for smooth probability curves
 */
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Calculate win probability timeline for a completed game
 */
export function calculateWinProbabilityTimeline(
  events: any[],
  homeTeamId: number,
  awayTeamId: number
): Array<{
  time: number;
  period: number;
  homeWinProb: number;
  awayWinProb: number;
  homeScore: number;
  awayScore: number;
}> {
  const timeline: Array<{
    time: number;
    period: number;
    homeWinProb: number;
    awayWinProb: number;
    homeScore: number;
    awayScore: number;
  }> = [];

  let homeScore = 0;
  let awayScore = 0;
  let homeShots = 0;
  let awayShots = 0;
  let homeXG = 0;
  let awayXG = 0;

  // Sample win probability at key moments
  events.forEach((event, index) => {
    const period = event.periodDescriptor?.number || 1;
    const timeInPeriod = event.timeInPeriod || '00:00';
    const [minutes, seconds] = timeInPeriod.split(':').map(Number);
    const periodTime = minutes * 60 + seconds;
    const timeElapsed = (period - 1) * 1200 + periodTime;
    const timeRemaining = 3600 - timeElapsed;

    // Update scores
    if (event.typeDescKey === 'goal') {
      if (event.details?.eventOwnerTeamId === homeTeamId) {
        homeScore++;
      } else if (event.details?.eventOwnerTeamId === awayTeamId) {
        awayScore++;
      }
    }

    // Update shots
    if (
      event.typeDescKey === 'shot-on-goal' ||
      event.typeDescKey === 'missed-shot' ||
      event.typeDescKey === 'blocked-shot' ||
      event.typeDescKey === 'goal'
    ) {
      if (event.details?.eventOwnerTeamId === homeTeamId) {
        homeShots++;
        if (event.details.xCoord && event.details.yCoord) {
          homeXG += calculateQuickXG(event.details.xCoord, event.details.yCoord);
        }
      } else if (event.details?.eventOwnerTeamId === awayTeamId) {
        awayShots++;
        if (event.details.xCoord && event.details.yCoord) {
          awayXG += calculateQuickXG(event.details.xCoord, event.details.yCoord);
        }
      }
    }

    // Calculate win prob at this moment
    const gameState: GameState = {
      period,
      timeRemaining: Math.max(0, timeRemaining),
      homeScore,
      awayScore,
      homeShotsFor: homeShots,
      awayShotsFor: awayShots,
      homeXG,
      awayXG,
      situation: 'even', // Simplified
    };

    const winProb = calculateWinProbability(gameState);

    // Sample key moments (goals, period changes, every 2 minutes)
    const isGoal = event.typeDescKey === 'goal';
    const isPeriodChange = index > 0 && events[index - 1].periodDescriptor?.number !== period;
    const isSampleTime = periodTime % 120 === 0;

    if (isGoal || isPeriodChange || isSampleTime) {
      timeline.push({
        time: timeElapsed,
        period,
        homeWinProb: winProb.homeWinProb,
        awayWinProb: winProb.awayWinProb,
        homeScore,
        awayScore,
      });
    }
  });

  return timeline;
}

/**
 * Quick xG calculation using corrected angle formula
 */
function calculateQuickXG(xCoord: number, yCoord: number): number {
  const netX = xCoord >= 0 ? 89 : -89;
  const distance = Math.sqrt(Math.pow(xCoord - netX, 2) + Math.pow(yCoord, 2));

  // Correct angle: 0 = center, higher = more to the side
  const distanceFromGoalLine = Math.abs(netX - xCoord);
  const lateralDistance = Math.abs(yCoord);
  const angle = distanceFromGoalLine > 0
    ? Math.atan(lateralDistance / distanceFromGoalLine) * (180 / Math.PI)
    : 90;

  const logit = -0.5 - 0.045 * distance - 0.025 * angle;
  return Math.max(0.005, Math.min(0.60, 1 / (1 + Math.exp(-logit))));
}

/**
 * Predict comeback probability
 * Given a deficit, time remaining, and performance metrics
 */
export function calculateComebackProbability(
  scoreDiff: number, // Negative if trailing
  timeRemaining: number,
  shotDiff: number,
  xgDiff: number
): {
  comebackProb: number;
  scenarioRating: 'very-unlikely' | 'unlikely' | 'possible' | 'likely';
} {
  if (scoreDiff >= 0) {
    // Not trailing
    return { comebackProb: 1.0, scenarioRating: 'likely' };
  }

  const goalsNeeded = Math.abs(scoreDiff);
  const minutesRemaining = timeRemaining / 60;

  // Base probability based on deficit and time
  // Rule of thumb: 1 goal per 10 minutes is realistic
  let baseProb = Math.max(0, minutesRemaining / (goalsNeeded * 10));

  // Adjust for shot/xG differential
  // Positive differential = better chances
  if (shotDiff > 0) baseProb *= 1 + shotDiff / 20;
  if (xgDiff > 0) baseProb *= 1 + xgDiff / 2;

  // Clamp
  const comebackProb = Math.min(0.95, Math.max(0.01, baseProb));

  // Rating
  let scenarioRating: 'very-unlikely' | 'unlikely' | 'possible' | 'likely';
  if (comebackProb > 0.5) scenarioRating = 'likely';
  else if (comebackProb > 0.25) scenarioRating = 'possible';
  else if (comebackProb > 0.1) scenarioRating = 'unlikely';
  else scenarioRating = 'very-unlikely';

  return {
    comebackProb: parseFloat(comebackProb.toFixed(3)),
    scenarioRating,
  };
}
