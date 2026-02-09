/**
 * Test script to verify NHL API play-by-play integration
 * Tests fetching real shot coordinates and converting to our format
 */

const NHL_API_BASE = 'https://api-web.nhle.com/v1';

// Test with a recent game - Connor McDavid (8478402) vs someone
// Let's use a recent Oilers game
const TEST_GAME_ID = 2024020001; // Opening night 2024-25 season

async function testPlayByPlay() {
  console.log('🏒 Testing NHL Play-by-Play API Integration\n');
  console.log(`Fetching game ${TEST_GAME_ID}...\n`);

  try {
    const response = await fetch(`${NHL_API_BASE}/gamecenter/${TEST_GAME_ID}/play-by-play`);

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    console.log('✅ Successfully fetched play-by-play data\n');

    // Extract shot events
    const shots = [];
    let goalCount = 0;
    let shotsOnGoal = 0;
    let missedShots = 0;
    let blockedShots = 0;

    if (data.plays) {
      data.plays.forEach((play) => {
        if (
          play.typeDescKey === 'shot-on-goal' ||
          play.typeDescKey === 'missed-shot' ||
          play.typeDescKey === 'blocked-shot' ||
          play.typeDescKey === 'goal'
        ) {
          if (play.details?.xCoord !== undefined && play.details?.yCoord !== undefined) {
            shots.push({
              eventId: play.eventId,
              period: play.periodDescriptor?.number || 1,
              time: play.timeInPeriod || '00:00',
              xCoord: play.details.xCoord,
              yCoord: play.details.yCoord,
              shotType: play.details.shotType || 'unknown',
              result: play.typeDescKey,
              player: play.details?.shootingPlayerId || 0,
            });

            // Count by type
            if (play.typeDescKey === 'goal') goalCount++;
            else if (play.typeDescKey === 'shot-on-goal') shotsOnGoal++;
            else if (play.typeDescKey === 'missed-shot') missedShots++;
            else if (play.typeDescKey === 'blocked-shot') blockedShots++;
          }
        }
      });
    }

    console.log('📊 Shot Attempt Statistics:');
    console.log(`   Total shot attempts: ${shots.length}`);
    console.log(`   Goals: ${goalCount}`);
    console.log(`   Shots on goal: ${shotsOnGoal}`);
    console.log(`   Missed shots: ${missedShots}`);
    console.log(`   Blocked shots: ${blockedShots}`);
    console.log(`   Corsi (all attempts): ${shots.length}`);
    console.log(`   Fenwick (unblocked): ${shots.length - blockedShots}\n`);

    // Show sample shots
    console.log('📍 Sample Shot Coordinates (first 5 shots):');
    shots.slice(0, 5).forEach((shot, i) => {
      console.log(`   ${i + 1}. Period ${shot.period} @ ${shot.time}`);
      console.log(`      Position: (${shot.xCoord}, ${shot.yCoord})`);
      console.log(`      Type: ${shot.shotType}`);
      console.log(`      Result: ${shot.result}\n`);
    });

    // Calculate distances for sample
    console.log('🎯 Shot Metrics (sample calculations):');
    const netX = 89;
    const netY = 0;

    shots.slice(0, 3).forEach((shot, i) => {
      const distance = Math.sqrt(
        Math.pow(shot.xCoord - netX, 2) + Math.pow(shot.yCoord - netY, 2)
      );
      const angle = Math.abs(
        Math.atan2(shot.yCoord - netY, shot.xCoord - netX) * (180 / Math.PI)
      );

      console.log(`   Shot ${i + 1}:`);
      console.log(`      Distance from net: ${distance.toFixed(1)} feet`);
      console.log(`      Angle: ${angle.toFixed(1)} degrees`);
      console.log(`      Shot type: ${shot.shotType}\n`);
    });

    console.log('✅ Test completed successfully!');
    console.log('\n🎉 Ready to integrate into UI');

  } catch (error) {
    console.error('❌ Error testing play-by-play API:', error.message);
    process.exit(1);
  }
}

testPlayByPlay();
