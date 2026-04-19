# NHL Analytics - Complete Testing Guide

## Quick Start

Run the complete test suite with one command:

```bash
npm run test:all
```

This runs both API tests and end-to-end browser tests.

---

## Individual Test Commands

### 1. API Tests (Fast, No Browser)
Tests NHL API connectivity and data fetching.

```bash
npm run test:api
```

**What it tests:**
- Player search endpoint
- Player info retrieval
- Team roster data
- NHL standings
- Schedule data

**Duration:** ~10 seconds

---

### 2. End-to-End Tests (Full Site Testing)

Tests the entire application in a real browser.

#### Basic E2E Test (Headless)
```bash
npm run test:e2e
```

#### Watch Mode with UI (Recommended for Development)
```bash
npm run test:e2e:ui
```
Opens Playwright's interactive UI where you can see tests run and debug failures.

#### With Visible Browser (See What's Happening)
```bash
npm run test:e2e:headed
```

#### View Last Test Report
```bash
npm run test:report
```

**What E2E tests cover:**
1. ✓ Home page loads correctly
2. ✓ Player search functionality works
3. ✓ Navigate to player profile from search
4. ✓ Player profile tabs work (Stats, Charts, Contract)
5. ✓ Statistics charts render on player profile
6. ✓ Navigation menu works
7. ✓ Player comparison page functionality
8. ✓ Trends page shows league leaders
9. ✓ Team standings are visible
10. ✓ Responsive design - mobile viewport
11. ✓ Ice rink charts render without errors
12. ✓ Contract details display correctly
13. ✓ Search handles special characters and edge cases
14. ✓ No console errors on critical pages
15. ✓ Performance - Pages load within acceptable time

**Duration:** ~60-90 seconds

---

## Test Results

### Passing Tests
All tests should pass with green checkmarks:
```
✓ Home page loads correctly
✓ Player search functionality works
✓ Navigate to player profile from search
...
```

### Failed Tests
If a test fails, you'll see:
- Red X mark
- Error message
- Screenshot (saved to `test-results/`)
- Detailed trace for debugging

---

## Debugging Failed Tests

### 1. View the HTML Report
```bash
npm run test:report
```

### 2. Run Tests in UI Mode
```bash
npm run test:e2e:ui
```
- Click on individual tests
- See step-by-step execution
- Inspect DOM at each step
- View network requests

### 3. Check Screenshots
Failed tests automatically save screenshots to:
```
test-results/
  ├── screenshots/
  └── traces/
```

---

## Manual Testing Checklist

If you want to manually verify features:

### 1. Home Page
- [ ] Page loads at http://localhost:5174/
- [ ] NHL branding visible
- [ ] Search box functional
- [ ] Navigation menu works

### 2. Player Search
- [ ] Search for "McDavid"
- [ ] Results appear in dropdown
- [ ] Click result navigates to profile
- [ ] Player name and photo display

### 3. Player Profile - Stats Tab
- [ ] Current season stats visible
- [ ] Career stats table displays
- [ ] Season progression charts render
- [ ] Stats are formatted correctly

### 4. Player Profile - Advanced Charts Tab
- [ ] Ice rink visualization displays
- [ ] Shot chart shows data points
- [ ] Heat map renders correctly
- [ ] Zone analysis displays
- [ ] No canvas errors in console

### 5. Player Profile - Contract Tab
- [ ] Cap hit displays with percentage
- [ ] Current salary shown
- [ ] Contract length and expiry visible
- [ ] Year-by-year breakdown table
- [ ] Comparable contracts listed
- [ ] Value assessment shown

### 6. Player Comparison
- [ ] Navigate to /compare
- [ ] Search for multiple players
- [ ] Add up to 4 players
- [ ] Radar chart displays
- [ ] Bar chart comparison works
- [ ] Metric selector functions

### 7. Trends/Analytics Page
- [ ] League leaders table displays
- [ ] Sort by different stats works
- [ ] Team standings visible
- [ ] Quick stats cards show data

### 8. Mobile Responsive
- [ ] Open Chrome DevTools
- [ ] Toggle device toolbar (Cmd+Shift+M)
- [ ] Test iPhone viewport
- [ ] All content accessible
- [ ] Search works on mobile
- [ ] Navigation menu works

---

## Performance Benchmarks

Expected load times:

| Page | Target | Acceptable |
|------|--------|------------|
| Home | < 2s | < 5s |
| Player Profile | < 3s | < 10s |
| Compare | < 2s | < 5s |
| Trends | < 3s | < 8s |

Test with:
```bash
# Lighthouse in Chrome DevTools
# Or using CLI:
npx lighthouse http://localhost:5174/ --view
```

---

## Troubleshooting

### Tests Fail: "net::ERR_CONNECTION_REFUSED"
**Problem:** Dev server not running

**Solution:**
```bash
npm run dev
```
Wait for "ready in Xms" message, then run tests.

---

### Tests Fail: CORS or Network Errors
**Problem:** Proxy not configured or NHL API down

**Solution:**
1. Check `vite.config.ts` has proxy configuration
2. Run API test: `npm run test:api`
3. Check NHL API status

---

### Ice Rink Charts Don't Render
**Problem:** Canvas errors in console

**Solution:**
1. Check browser console for specific errors
2. Verify IceRinkChart.tsx line 206-207 (gradient color stops)
3. Ensure data prop has valid DataPoint[] format

---

### Player Profile Shows "Error Loading Player"
**Problem:** API fetch failed

**Solutions:**
1. Check network tab in DevTools
2. Verify proxy is working: `/api/nhl/...` requests should succeed
3. Try known player ID: http://localhost:5174/player/8478402 (McDavid)
4. Check if NHL API is down: `npm run test:api`

---

## Continuous Integration

To run tests in CI/CD:

```yaml
# Example GitHub Actions
- name: Install dependencies
  run: npm ci

- name: Install Playwright browsers
  run: npx playwright install --with-deps

- name: Run tests
  run: npm run test:all
```

---

## Test Coverage

### ✅ Covered
- Home page rendering
- Player search (autocomplete, debouncing)
- Player profile (all 3 tabs)
- Data visualizations (Recharts + Canvas)
- Navigation between pages
- Responsive design
- Error handling
- Performance metrics
- API connectivity

### 🔄 Future Tests (Optional)
- Keyboard navigation
- Screen reader accessibility
- Multiple browser testing (Firefox, Safari)
- Load testing with many players
- Offline behavior
- Print styles

---

## Quick Reference

```bash
# Start dev server
npm run dev

# Test everything
npm run test:all

# Just API
npm run test:api

# E2E with UI
npm run test:e2e:ui

# Build for production
npm run build

# Preview production build
npm run preview
```

---

## Success Criteria

✅ **All tests passing** means:
- API connectivity works
- All pages load without errors
- Player search functions correctly
- Charts and visualizations render
- Navigation works smoothly
- No critical console errors
- Performance within acceptable range

Your NHL Analytics site is **production-ready**! 🎉
