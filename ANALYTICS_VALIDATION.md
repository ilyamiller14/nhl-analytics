# NHL Analytics Validation Report

## Overview
This document validates every analytics metric computed in the NHL Analytics application against industry standards from authoritative sources (Moneypuck, Evolving Hockey, Natural Stat Trick, Hockey Graphs).

---

## 1. Expected Goals (xG) Model

### Industry Standard (Moneypuck, Evolving Hockey)
- **Method**: Gradient boosting machine (GBM) or logistic regression
- **Key Variables** (in order of importance):
  1. Shot Distance (most important - ~8% decrease per additional foot)
  2. Shot Angle (~7% increase per degree toward center)
  3. Time since last shot (rebounds)
  4. Shot type
  5. Game situation (5v5, PP, SH)

- **Typical xG Values**:
  - Point shot: ~0.02 (2%)
  - Perimeter wrist shot: 0.03-0.08
  - Mid-range chance: 0.10-0.15
  - High-danger slot: 0.25-0.35
  - One-timer from slot: 0.30+

- **Danger Thresholds** (Natural Stat Trick):
  - Low danger: xG < 0.08
  - Medium danger: 0.08-0.15
  - High danger: xG >= 0.15

- **Rush Shot Impact**: Research shows rush shots are NOT more efficient once you control for distance/angle (slightly negative coefficient with marginal significance)

- **Rebound Impact**: Strongly positive - roughly DOUBLE the goal odds

### Our Implementation (`xgModel.ts`)
```
logit = -0.5 + (distance * -0.045) + (angle * -0.025)
      + log(shotTypeMultiplier) + log(strengthMultiplier)
      + reboundBonus(0.6) + rushShotBonus(0.25)
xG = 1 / (1 + exp(-logit))
Clamped to: 0.005 - 0.60
```

### VALIDATION STATUS

| Aspect | Standard | Our Implementation | Status |
|--------|----------|-------------------|--------|
| Distance coefficient | -0.08 per foot (approx) | -0.045 | CLOSE - may need calibration |
| Angle coefficient | -0.07 per degree | -0.025 | REASONABLE |
| Output range | 0.01-0.40+ typical | 0.005-0.60 | CORRECT |
| High danger threshold | >= 0.15 | >= 0.15 | CORRECT |
| Medium danger threshold | 0.08-0.15 | 0.08-0.15 | CORRECT |
| Rush bonus | ~0 or slightly negative | +0.25 | INCORRECT - Should be near 0 |
| Rebound bonus | ~2x multiplier | +0.6 additive | NEEDS REVIEW |
| Shot type multipliers | Tips most dangerous | Tips: 1.35 | CORRECT direction |

### ISSUES FOUND
1. **Rush shot bonus is WRONG** - Research shows rush shots are NOT more efficient. Should be 0 or slightly negative, not +0.25
2. **Distance coefficient may be too small** - Standard is ~0.08 per foot vs our 0.045
3. **Strength parsing not implemented** - `playByPlayService.ts` always defaults to '5v5', PP/PK multipliers never applied

### RECOMMENDATIONS
- Remove or significantly reduce rush shot bonus
- Consider increasing distance coefficient to -0.06 to -0.08
- Implement proper strength situation parsing from NHL API situationCode

---

## 2. Corsi & Fenwick

### Industry Standard (Natural Stat Trick, Hockey Reference)

**Corsi For (CF)**:
- All shot attempts: Goals + Shots on Goal + Missed Shots + Blocked Shots
- Measured at even strength (5v5)

**Corsi For Percentage (CF%)**:
- Formula: CF / (CF + CA) * 100
- 50% = neutral/average
- 52-55% = good possession
- >55% = elite possession

**Fenwick For (FF)**:
- Unblocked shot attempts: Goals + Shots on Goal + Missed Shots
- EXCLUDES blocked shots
- Also called USAT by NHL

**Fenwick For Percentage (FF%)**:
- Formula: FF / (FF + FA) * 100
- Same thresholds as Corsi

### Our Implementation (`advancedMetrics.ts`)

```typescript
// Corsi = all shot attempts
const corsiFor = shotsFor.length;  // includes goals, shots, misses, blocks
const corsiAgainst = shotsAgainst.length;
const corsiForPct = CF / (CF + CA) * 100;

// Fenwick = unblocked
const fenwickFor = shotsFor.filter(s => s.type !== 'block').length;
const fenwickForPct = FF / (FF + FA) * 100;
```

### VALIDATION STATUS

| Aspect | Standard | Our Implementation | Status |
|--------|----------|-------------------|--------|
| Corsi includes blocks | Yes | Yes | CORRECT |
| Fenwick excludes blocks | Yes | Yes | CORRECT |
| CF% formula | CF/(CF+CA)*100 | CF/(CF+CA)*100 | CORRECT |
| 50% = average | Yes | Yes | CORRECT |
| Even strength only | Yes | Partially | NEEDS WORK - should filter by strength |

### ISSUES FOUND
1. **No strength-state filtering** - Should separate 5v5, PP, PK, All-Situations
2. **Estimation mode when no play-by-play** uses +/- as proxy, which is weak correlation

---

## 3. PDO

### Industry Standard
- **Formula**: Shooting% + Save% (scaled to 1000 or 100)
- **Average**: 1000 (or 100.0)
- **Sustainable range**: 990-1010
- **Above 1020**: Running hot (luck)
- **Below 980**: Running cold (bad luck)

### Our Implementation (`advancedMetrics.ts`)

```typescript
const shootingPct = (goals / shotsOnGoal) * 100;
const savePct = ((shotsAgainstOnGoal - goalsAgainst) / shotsAgainstOnGoal) * 100;
const pdo = shootingPct + savePct;
```

### VALIDATION STATUS

| Aspect | Standard | Our Implementation | Status |
|--------|----------|-------------------|--------|
| Formula | Sh% + Sv% | Sh% + Sv% | CORRECT |
| Average | 100 | 100 | CORRECT |
| Clamped range | None standard | 92-108 | ACCEPTABLE |

### ISSUES FOUND
1. Uses PERSONAL shooting % instead of ON-ICE shooting % for individual player PDO
2. Save % estimation uses +/- as proxy (weak)

---

## 4. Zone Entries & Exits

### Industry Standard (Eric Tulsky, Corey Sznajder Research)

**Controlled Entry Benefits**:
- Yields 34% higher goal probability than dump-in
- Controlled entry: ~0.57 shots per entry
- Dump-in: ~0.12 shots per entry

**Entry Success Definition**:
- Maintaining possession in offensive zone
- Leading to a shot or sustained pressure

**Exit Success Definition**:
- Carry-outs/pass-outs: ~90% success rate
- Dump-outs: ~20-25% success rate

**Coordinate System** (NHL API):
- Center ice: (0, 0)
- X range: -100 to +100 (goal lines at ~89)
- Y range: -42.5 to +42.5
- Blue lines at: x = -25 and x = +25

### Our Implementation (`zoneTracking.ts`)

```typescript
export function getZone(xCoord: number): ZoneType {
  if (xCoord > 25) return 'offensive';
  if (xCoord < -25) return 'defensive';
  return 'neutral';
}
```

### VALIDATION STATUS

| Aspect | Standard | Our Implementation | Status |
|--------|----------|-------------------|--------|
| Blue lines at x=±25 | Yes | Yes | CORRECT |
| Controlled vs dump classification | Based on carry/shot | Based on event type | REASONABLE |
| Entry success tracking | Possession maintained | Next 3-5 events | ACCEPTABLE |
| Exit success tracking | Possession maintained | Next 4 events | ACCEPTABLE |

### ISSUES FOUND
1. **`breakoutAnalytics.ts` has DIFFERENT zone boundaries** (x<25 for defensive, x>75 for offensive) - INCONSISTENT
2. Zone detection depends on consecutive events having same team ID - may miss some entries
3. Faceoff after entry always classified as "dump" - oversimplified

---

## 5. Royal Road Passes

### Industry Standard (Steve Valiquette, NHL Analytics)

**Definition**: Pass crossing the center line of the ice (net-to-net line) below the circles, resulting in a shot

**Shooting Percentage Impact**:
- Royal road passes: **30% shooting percentage**
- Non-royal-road: **8.5% shooting percentage**
- That's ~3.5x more effective!

**Goal Attribution**:
- 22% of all NHL goals come from royal road passes
- Only 9% of shots from same side of royal road result in goals

**Key Criteria**:
- Pass must cross the vertical center line
- Must occur below the faceoff circles (in high-danger area)
- Must result in a shot

### Our Implementation (`advancedPassAnalytics.ts`)

```typescript
const horizontalDistance = Math.abs(passEndY - passStartY);
if (horizontalDistance > 20) {  // 20 feet threshold
  // Classified as royal road
}
```

### VALIDATION STATUS

| Aspect | Standard | Our Implementation | Status |
|--------|----------|-------------------|--------|
| Cross-ice threshold | Crosses center line | > 20 feet Y movement | REASONABLE proxy |
| Must result in shot | Yes | Yes | CORRECT |
| In slot area | Below circles | x: 69-89, y: ±10 | CORRECT |

### ISSUES FOUND
1. Uses hardcoded 20ft threshold instead of detecting center-line crossing
2. Pass start coordinates inferred from previous event, not actual pass data
3. Different xG function used (`estimateXG`) with different coefficients than main model - INCONSISTENCY

---

## 6. WAR (Wins Above Replacement)

### Industry Standard (Evolving Hockey)

**Components**:
1. EV Offense (even-strength offense)
2. EV Defense (even-strength defense)
3. Powerplay Offense
4. Shorthanded Defense
5. Penalties Drawn/Taken
6. Shooting impact

**Method**: RAPM (Regularized Adjusted Plus Minus) -> SPM (Statistical Plus-Minus) -> Convert to Wins

**Typical Values**:
- MVP-caliber: 8+ WAR
- All-Star: 5-8 WAR
- Above-average: 2-5 WAR
- Replacement-level: 0-2 WAR
- Below replacement: Negative

**Replacement Level**: 14th forward, 8th defenseman per team

### Our Implementation (`advancedMetrics.ts`)

```typescript
const pointsPer60 = ((goals + assists) / toiMinutes) * 60;
const replacementLevel = position === 'D' ? 0.4 : 0.8;
const pointsAboveReplacement = (pointsPer60 - replacementLevel) * (toiMinutes / 60);
const war = pointsAboveReplacement / 6;
```

### VALIDATION STATUS

| Aspect | Standard | Our Implementation | Status |
|--------|----------|-------------------|--------|
| Components | 6 (offense, defense, PP, PK, penalties, shooting) | 1 (points only) | SEVERELY SIMPLIFIED |
| Method | RAPM + SPM + regression | Simple points/60 | SEVERELY SIMPLIFIED |
| Typical values | 0-8+ for elite | Similar range | SOMEWHAT ALIGNED |

### ISSUES FOUND
1. **WAR is SEVERELY OVERSIMPLIFIED** - uses only raw points, ignores:
   - Defensive impact
   - Quality of competition
   - Quality of teammates
   - Special teams (separate from EV)
   - Penalty differential
2. Code comment acknowledges this: "In reality, WAR is much more complex"
3. Consider renaming to "Estimated Offensive Contribution" or similar

---

## 7. Team Ratings

### Our Implementation (`teamAnalytics.ts`)

```typescript
// Offense: 3.2 GF/game = 55 (average)
offenseRating = ((gfPerGame - 3.2) / 0.5) * 20 + 55

// Defense: 3.0 GA/game = 55 (average)
defenseRating = ((3.0 - gaPerGame) / 0.5) * 20 + 55

// Special Teams: Index of 100 = 55
specialTeamsRating = ((ppPct + pkPct - 100) / 10) * 20 + 55

// Overall: 40% offense, 40% defense, 20% special teams
overall = (offense * 0.4) + (defense * 0.4) + (specialTeams * 0.2)
```

### VALIDATION STATUS

| Aspect | Standard | Our Implementation | Status |
|--------|----------|-------------------|--------|
| League avg GF/game | 3.0-3.2 | 3.2 | CORRECT for 2024-25 |
| League avg GA/game | 3.0 | 3.0 | CORRECT |
| PP% + PK% index | ~100 | 100 | CORRECT |
| Weighting | No standard | 40/40/20 | REASONABLE |

### ISSUES FOUND
1. Hardcoded for 2024-25 season - needs yearly calibration
2. Defense rating doesn't separate goaltending from shot suppression
3. No sample size / games played adjustment

---

## 8. Coordinate System Validation

### Industry Standard (NHL API)
- **Origin**: (0, 0) at center ice
- **X range**: -100 to +100 (goal lines at ±89)
- **Y range**: -42.5 to +42.5
- **Blue lines**: x = ±25
- **Slot area**: x: 69-89, y: ±20 (approximately)

### Our Implementation

```typescript
// rink.ts constants
MIN_X: -100, MAX_X: 100
MIN_Y: -43, MAX_Y: 43
CENTER_X: 0, CENTER_Y: 0

// Zone classification
if (xCoord > 25) return 'offensive';
if (xCoord < -25) return 'defensive';
return 'neutral';

// Slot definition
if (xCoord >= 69 && xCoord <= 89 && Math.abs(yCoord) <= 10) {
  return 'slot';
}
```

### VALIDATION STATUS: CORRECT
- Coordinate ranges match NHL API
- Blue line positions correct at x = ±25
- Goal lines correctly at x = ±89

---

## Summary of Critical Issues

### CRITICAL (Must Fix)

1. **Rush shot bonus is WRONG** - Should be 0 or negative, not +0.25
2. **Strength situation always defaults to 5v5** - PP/PK multipliers never applied
3. **xG function duplication** - Different coefficients in `advancedPassAnalytics.ts` vs `xgModel.ts`
4. **Zone boundary inconsistency** - `breakoutAnalytics.ts` uses different thresholds than `zoneTracking.ts`

### HIGH PRIORITY (Should Fix)

5. **WAR is oversimplified** - Uses only points, misses defense/penalties/context
6. **PDO uses personal shooting% not on-ice** for individuals
7. **No strength-state filtering** for Corsi/Fenwick

### MEDIUM PRIORITY (Nice to Fix)

8. **Distance coefficient may be too small** (0.045 vs industry 0.06-0.08)
9. **Royal road uses previous event coords** instead of actual pass data
10. **Team ratings hardcoded** for 2024-25 season

---

## Validation Checklist

| Metric | Math Correct? | Industry Aligned? | Issues? |
|--------|--------------|-------------------|---------|
| xG base formula | YES | MOSTLY | Rush bonus wrong |
| xG danger thresholds | YES | YES | None |
| Corsi formula | YES | YES | No strength filter |
| Fenwick formula | YES | YES | No strength filter |
| PDO formula | YES | PARTIAL | Uses personal not on-ice |
| Zone boundaries | YES | YES | None |
| Royal road threshold | YES | CLOSE | Uses distance not centerline |
| WAR formula | NO | NO | Severely oversimplified |
| Team ratings | YES | YES | Season-specific |

---

*Generated: February 2026*
*Sources: Moneypuck, Evolving Hockey, Natural Stat Trick, Hockey Graphs, NHL API Documentation*
