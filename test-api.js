#!/usr/bin/env node

/**
 * NHL API Test Script
 * Tests the NHL API endpoints to verify connectivity and data fetching
 */

const NHL_API_BASE = 'https://api-web.nhle.com/v1';

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
  bold: '\x1b[1m',
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function success(message) {
  log(`✓ ${message}`, colors.green);
}

function error(message) {
  log(`✗ ${message}`, colors.red);
}

function info(message) {
  log(`ℹ ${message}`, colors.blue);
}

function header(message) {
  log(`\n${colors.bold}${message}${colors.reset}`);
}

async function testEndpoint(name, url, validator) {
  try {
    info(`Testing: ${name}`);
    const response = await fetch(url);

    if (!response.ok) {
      error(`Failed: ${name} - HTTP ${response.status}`);
      return false;
    }

    const data = await response.json();

    if (validator && !validator(data)) {
      error(`Failed: ${name} - Invalid data structure`);
      return false;
    }

    success(`Passed: ${name}`);
    return true;
  } catch (err) {
    error(`Failed: ${name} - ${err.message}`);
    return false;
  }
}

async function runTests() {
  header('NHL Analytics API Test Suite');
  log('Testing NHL API endpoints...\n');

  const tests = [
    {
      name: 'Player Spotlight (Featured Players)',
      url: `${NHL_API_BASE}/player-spotlight`,
      validator: (data) => Array.isArray(data) && data.length > 0,
    },
    {
      name: 'Player Info (Connor McDavid - 8478402)',
      url: `${NHL_API_BASE}/player/8478402/landing`,
      validator: (data) => data.playerId === 8478402 && data.firstName && data.lastName,
    },
    {
      name: 'Team Roster (Edmonton Oilers)',
      url: `${NHL_API_BASE}/roster/EDM/current`,
      validator: (data) => data.forwards && data.defensemen && data.goalies,
    },
    {
      name: 'NHL Standings',
      url: `${NHL_API_BASE}/standings/now`,
      validator: (data) => data.standings && data.standings.length > 0,
    },
    {
      name: 'Schedule',
      url: `${NHL_API_BASE}/schedule/now`,
      validator: (data) => data.gameWeek || data.nextStartDate,
    },
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    const result = await testEndpoint(test.name, test.url, test.validator);
    if (result) {
      passed++;
    } else {
      failed++;
    }
    // Add small delay between requests
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  header('\nTest Results');
  log(`Total Tests: ${tests.length}`);
  success(`Passed: ${passed}`);
  if (failed > 0) {
    error(`Failed: ${failed}`);
  }

  if (passed === tests.length) {
    log('\n' + colors.green + colors.bold + '🎉 All tests passed! The NHL API is working correctly.' + colors.reset);
  } else {
    log('\n' + colors.yellow + '⚠️  Some tests failed. Check your network connection or the NHL API status.' + colors.reset);
  }

  header('\nLocal Development Server');
  info('If tests passed but the app shows CORS errors, make sure:');
  log('  1. The dev server is running: npm run dev');
  log('  2. Access the app at: http://localhost:5174/');
  log('  3. The proxy is configured in vite.config.ts');
}

// Run tests
runTests().catch(err => {
  error(`Test suite failed: ${err.message}`);
  process.exit(1);
});
