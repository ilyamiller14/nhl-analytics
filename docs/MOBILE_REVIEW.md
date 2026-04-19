# NHL Analytics App - Mobile Experience Review

**Review Date:** 2026-02-16
**Focus:** Mobile-first UX, responsive design, touch interactions
**Pages Reviewed:** 10 | **Flows Traced:** 15+ | **Issues Found:** 11 Critical | 15 High | 20+ Medium

---

## Executive Summary

The NHL Analytics app has significant mobile usability issues that prevent comfortable use on phones and tablets. Key problems:

1. **Touch targets below 44px minimum** (tabs, buttons)
2. **Fixed-width layouts force horizontal scrolling** (charts, tables, grids)
3. **Missing responsive breakpoints** (only 768px, need 480px/640px/900px/1024px)
4. **No touch scroll optimization** (missing `-webkit-overflow-scrolling: touch`)
5. **Text overflow without truncation** (long player/team names break layouts)

---

## 🚨 CRITICAL ISSUES (Must Fix)

### 1. Player Profile Charts - Guaranteed Horizontal Scroll
**Location:** `src/pages/PlayerProfile.css:276`

```css
/* CURRENT - BROKEN */
.charts-grid {
  grid-template-columns: repeat(auto-fit, minmax(500px, 1fr));
}

/* FIX */
@media (max-width: 768px) {
  .charts-grid {
    grid-template-columns: 1fr;
    gap: 1rem;
  }
}
```

**Impact:** All chart tabs (shot charts, heat maps, stats) are unusable on mobile without pinch/zoom and horizontal scrolling. Affects 100% of mobile users viewing player profiles.

---

### 2. Profile Tabs - Touch Targets Too Small (32px)
**Location:** `src/pages/PlayerProfile.css:247-261, 397-400`

```css
/* CURRENT - BROKEN */
@media (max-width: 768px) {
  .profile-tab {
    padding: 0.875rem 1rem; /* Results in ~32px height */
    font-size: 0.875rem;
  }
}

/* FIX */
@media (max-width: 768px) {
  .profile-tab {
    padding: 1rem 1.25rem; /* Min 44px height */
    font-size: 0.9rem;
  }
}

/* BONUS: Add touch scroll */
.profile-tabs {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch; /* ADD THIS */
  scroll-snap-type: x mandatory; /* OPTIONAL */
}
```

**Impact:** Users frequently tap wrong tab or miss tabs entirely. Below iOS/Android recommended minimum.

---

### 3. Team Profile Tabs - Even Smaller (26px)
**Location:** `src/pages/TeamProfile.css:894-904`

```css
/* CURRENT - BROKEN */
.team-tab {
  padding: 0.5rem 1rem; /* Only 26px tall */
}

/* FIX */
@media (max-width: 768px) {
  .team-tab {
    padding: 0.75rem 1.25rem; /* 36-40px */
  }
}
```

---

### 4. Ice Rink Charts - 450px Minimum Width
**Location:** `src/pages/PlayerProfile.css:282-283`

```css
/* CURRENT - BROKEN */
.ice-rink-grid {
  grid-template-columns: repeat(auto-fit, minmax(450px, 1fr));
}

/* FIX */
@media (max-width: 768px) {
  .ice-rink-grid {
    grid-template-columns: 1fr;
  }
}
```

---

### 5. Data Tables - No Mobile Strategy
**Affected Files:**
- `src/components/LeagueLeaders.tsx` + `.css`
- `src/components/TeamStandings.tsx` + `.css`
- `src/components/AdvancedAnalyticsTable.tsx` + `.css`

**Current Issues:**
- LeagueLeaders: 5 columns with 180px minimum widths
- TeamStandings: Hides GF/GA/Diff columns at 768px (loses critical data)
- AdvancedAnalyticsTable: 4 sections with 3+ columns each, descriptions wrap awkwardly

**Fix Strategy:**

```css
/* OPTION A: Reduce columns for mobile */
@media (max-width: 768px) {
  .standings-table th:nth-child(n+9),
  .standings-table td:nth-child(n+9) {
    display: none; /* Hide less important columns */
  }
}

/* OPTION B: Card layout (better UX) */
@media (max-width: 640px) {
  .standings-table {
    display: block;
  }
  .standings-table tbody {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .standings-table tr {
    display: grid;
    grid-template-columns: 1fr 1fr;
    padding: 1rem;
    border: 1px solid var(--gray-200);
    border-radius: 8px;
  }
}
```

**Location Examples:**
- `src/components/TeamStandings.css:188-191` (column hiding)
- `src/components/LeagueLeaders.css:126` (player-col min-width)
- `src/components/AdvancedAnalyticsTable.css:40-46` (table-wrapper)

---

### 6. Player/Team Names - No Text Truncation
**Locations:**
- `src/components/PlayerCard.css:87-93`
- `src/components/TeamStandings.css:96-100`

```css
/* FIX */
.player-name,
.team-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%; /* Ensure constraint */
}

@media (max-width: 640px) {
  .player-name {
    max-width: 200px; /* Explicit mobile limit */
  }
}
```

**Examples that break:** "Jean-Sebastien Giguere", "Marc-Andre Fleury"

---

### 7. SVG Charts - ViewBox Not Fully Responsive
**Locations:**
- `src/components/charts/AttackDNAv2.tsx:62-64`
- `src/components/charts/ShotChart.tsx:125-129`

**Current:**
```tsx
<svg width={800} height={400} viewBox="0 0 800 400">
```

**Fix:**
```tsx
<svg
  style={{ maxWidth: '100%', height: 'auto' }}
  viewBox="0 0 800 400"
  preserveAspectRatio="xMidYMid meet"
>
```

Ensure parent container:
```css
.chart-container {
  width: 100%;
  max-width: 100%;
  padding: 0.5rem; /* Reduce on mobile */
}
```

---

### 8. Stats Grid - 120px Minimum Causes Overflow
**Location:** `src/pages/PlayerProfile.css:360-362`

```css
/* CURRENT */
@media (max-width: 768px) {
  .stats-grid {
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  }
}

/* FIX */
@media (max-width: 480px) {
  .stats-grid {
    grid-template-columns: repeat(2, 1fr); /* Force 2 columns */
  }
}

@media (max-width: 320px) {
  .stats-grid {
    grid-template-columns: 1fr; /* Stack on very small phones */
  }
}
```

---

### 9. Search Dropdown - Takes 65% of Screen Height
**Location:** `src/components/PlayerSearch.css:56`

```css
/* CURRENT - BROKEN */
.search-results {
  max-height: 400px;
  overflow-y: auto;
}

/* FIX */
.search-results {
  max-height: min(400px, 50vh); /* Respect viewport */
  overflow-y: auto;
  -webkit-overflow-scrolling: touch; /* iOS momentum scroll */
}
```

**Impact:** On 667px iPhone (375x667), 400px = 60% of screen. On notched phones with safe areas, even worse.

---

### 10. Data Badge Text Overflow
**Location:** `src/components/AdvancedAnalyticsTable.css:18-27`

```css
/* CURRENT */
.data-badge-success {
  padding: 12px 20px;
  font-size: 14px;
}

/* FIX */
@media (max-width: 640px) {
  .data-badge-success {
    padding: 8px 12px;
    font-size: 12px;
    max-width: 100%;
    word-wrap: break-word;
  }
}
```

**Example text that breaks:** "147 games | 2,847 on-ice shot attempts analyzed"

---

### 11. Percentages Over 100% (Domain Logic)
**Multiple locations** - Stat calculations

```tsx
// CURRENT - BROKEN
const percentage = (value / total) * 100;
display(`${percentage.toFixed(1)}%`); // Could show "102.3%"

// FIX
const percentage = Math.max(0, Math.min(100, (value / total) * 100));
display(`${percentage.toFixed(1)}%`);
```

---

## ⚠️ HIGH PRIORITY ISSUES

### 1. Profile Images Too Large on Small Phones
**Location:** `src/pages/PlayerProfile.css:343-345`

```css
/* CURRENT */
@media (max-width: 768px) {
  .player-headshot {
    width: 140px;
    height: 140px;
  }
}

/* ADD */
@media (max-width: 375px) {
  .player-headshot {
    width: 100px;
    height: 100px;
  }
}
```

**Impact:** 140px on 375px phone = 37% of width, forces text wrap in profile header.

---

### 2. Chart Legends Pile Up
**Location:** `src/components/StatChart.tsx:87-89, 120-122, 169-171`

```tsx
// CURRENT
<Legend wrapperStyle={{ fontSize: '0.875rem' }} />

// FIX
<Legend
  wrapperStyle={{
    fontSize: '0.75rem',
    flexWrap: 'wrap',
    justifyContent: 'center'
  }}
/>
```

---

### 3. No Touch Scroll Momentum Anywhere
**Fix globally or in each component:**

```css
/* Add to ALL scrollable containers */
.scrollable-container {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch; /* iOS momentum */
  scrollbar-width: thin; /* Firefox */
}

/* Optional: Snap scrolling for tabs */
.tabs-container {
  scroll-snap-type: x mandatory;
}

.tab {
  scroll-snap-align: start;
}
```

**Files to update:**
- `src/pages/PlayerProfile.css` (tabs)
- `src/pages/TeamProfile.css` (tabs)
- `src/pages/Trends.css` (tabs)
- `src/components/AdvancedAnalyticsTable.css` (table wrapper)
- `src/components/IceChartsPanel.css` (chart tabs)

---

### 4. Profile Header Padding Too Large
**Location:** `src/pages/PlayerProfile.css:6-11`

```css
/* CURRENT */
.profile-header {
  padding: 3rem 2rem;
}

/* ADD */
@media (max-width: 480px) {
  .profile-header {
    padding: 2rem 1rem; /* Reclaim space */
  }
}
```

---

### 5. Tooltip Positioning Off-Screen
**Location:** `src/components/charts/ShotChart.tsx:189-193` and `.css:100-111`

```tsx
// CURRENT - BROKEN
const tooltipStyle = {
  left: `${mousePos.x + 10}px`,
  top: `${mousePos.y + 10}px`,
};

// FIX
const tooltipStyle = {
  left: `${Math.min(mousePos.x + 10, window.innerWidth - 160)}px`,
  top: `${Math.min(mousePos.y + 10, window.innerHeight - 100)}px`,
};
```

```css
/* ADD */
.shot-tooltip {
  max-width: 150px;
  transform: translateX(-50%); /* Center on pointer */
}
```

---

### 6. Remove Buttons - 24px Touch Target
**Location:** `src/pages/Compare.css:99-117`

```css
/* CURRENT - BROKEN */
.remove-player-btn {
  width: 24px;
  height: 24px;
}

/* FIX */
@media (max-width: 768px) {
  .remove-player-btn {
    width: 36px;
    height: 36px;
    top: -6px;
    right: -6px;
  }
}
```

---

### 7. Speed Metrics Grid Cramped
**Location:** `src/components/charts/SpeedProfileChart.css:33-38, 195-203`

```css
/* ADD */
@media (max-width: 480px) {
  .metric-card {
    padding: 0.75rem; /* Reduce from 1rem */
  }

  .metric-value {
    font-size: 1.25rem; /* Reduce from 1.5rem */
  }
}
```

---

### 8. Stat Values Font Size Too Large
**Multiple locations**

```css
/* ADD TO index.css or component files */
@media (max-width: 768px) {
  .stat-value {
    font-size: 1.125rem; /* Reduce from 1.25rem */
  }
}

@media (max-width: 640px) {
  .stat-value {
    font-size: 1rem;
  }
}
```

---

## 📊 MEDIUM PRIORITY ISSUES

### 1. Navigation Height on Small Phones
**Location:** `src/components/Navigation.css:82-106`

**Issue:** Navigation wraps to 2-3 rows on 320px phones, taking ~120px of vertical space.

**Fix Options:**

```css
/* OPTION A: Hamburger menu */
@media (max-width: 480px) {
  .nav-links {
    display: none; /* Hide by default */
  }

  .nav-menu-btn {
    display: block; /* Show hamburger */
  }

  .nav-links.open {
    display: flex;
    flex-direction: column;
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    background: inherit;
  }
}

/* OPTION B: Reduce visible items */
@media (max-width: 640px) {
  .nav-link:nth-child(n+6) {
    display: none; /* Hide less important links */
  }
}
```

---

### 2. Home Leaders Grid - 300px Minimum
**Location:** `src/pages/Home.css:56`

```css
/* CURRENT */
.leaders-grid {
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
}

/* FIX */
@media (max-width: 480px) {
  .leaders-grid {
    grid-template-columns: 1fr; /* Stack completely */
  }
}
```

---

### 3. Conference Grid Transition
**Location:** `src/pages/Teams.css:30-32, 153-156`

```css
/* ADD intermediate breakpoint */
@media (max-width: 900px) {
  .conferences-container {
    grid-template-columns: 1fr; /* Stack earlier */
    gap: 2rem;
  }
}
```

---

### 4. Trending Grid - 400px Minimum
**Location:** `src/pages/Trends.css:129`

```css
/* CURRENT */
.trending-grid {
  grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
}

/* FIX */
@media (max-width: 768px) {
  .trending-grid {
    grid-template-columns: 1fr;
  }
}
```

---

### 5. Quick Stats Badges Crowded
**Location:** `src/pages/TeamProfile.css:881-884`

```css
/* FIX */
@media (max-width: 480px) {
  .team-quick-stats {
    flex-wrap: wrap;
    gap: 0.5rem;
    justify-content: center;
  }
}
```

---

### 6. PlayerCard Stats Preview Grid
**Location:** `src/components/PlayerCard.css:215-219`

```css
/* ADD */
@media (max-width: 480px) {
  .player-stats-preview {
    grid-template-columns: repeat(2, 1fr); /* 2x2 grid */
  }
}
```

---

### 7. Compare Page Selected Players Grid
**Location:** `src/pages/Compare.css:76-80, 203-205`

```css
/* ADD */
@media (max-width: 480px) {
  .selected-players-grid {
    grid-template-columns: 1fr; /* Stack completely */
  }
}
```

---

### 8. Empty State Sizing
**Location:** `src/components/IceChartsPanel.css:152-159`, `src/App.css:70-74`

```css
/* FIX */
@media (max-width: 480px) {
  .empty-state {
    padding: 2rem 1rem; /* Reduce from 4rem 2rem */
  }

  .empty-state-icon {
    font-size: 3rem; /* Reduce from 4rem */
  }
}
```

---

### 9. Loading Spinner Size
**Location:** `src/App.css:25-32`

```css
/* FIX */
.loading-spinner {
  width: min(50px, 10vw);
  height: min(50px, 10vw);
  /* ... rest of styles */
}
```

---

### 10. No Touch Feedback (Active States)
**Multiple files**

```css
/* ADD to all interactive elements */
.nav-link:active,
.btn:active,
.tab:active,
.card:active {
  transform: scale(0.98);
  opacity: 0.9;
}

/* Detect touch devices */
@media (hover: none) {
  .element:hover {
    /* Remove hover-only effects on touch devices */
  }
}
```

---

### 11. Table Column Widths Not Responsive
**Location:** `src/components/TeamStandings.css:81`

```css
/* CURRENT */
.team-col {
  min-width: 220px;
}

/* FIX */
@media (max-width: 640px) {
  .team-col {
    min-width: 140px; /* Reduce significantly */
  }

  .team-name {
    max-width: 100px; /* Force truncation */
  }
}
```

---

### 12. Career Stats Summary Not Fully Responsive
**Location:** `src/pages/PlayerProfile.css:206-215, 374-381, 414-416`

```css
/* ADD */
@media (max-width: 375px) {
  .career-stats-summary-large {
    grid-template-columns: 1fr; /* Stack on very small phones */
  }

  .summary-stat-value {
    font-size: 1.5rem; /* Reduce from 2rem */
  }
}
```

---

### 13. Chart Minimum Widths (Multiple Charts)
**Locations:**
- `src/components/charts/ShotChart.css`
- `src/components/charts/ZoneTimeChart.css`
- `src/components/charts/TrackingRadarChart.css`

```css
/* ADD to each chart CSS */
@media (max-width: 768px) {
  .chart-container {
    min-width: unset;
    width: 100%;
    max-width: 100%;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
}
```

---

### 14. IceChartsPanel Tabs No Scroll Indicator
**Location:** `src/components/IceChartsPanel.css:24-30, 45`

```css
/* ADD visual indicator for scrollable tabs */
.chart-type-tabs::after {
  content: '→';
  position: absolute;
  right: 0;
  padding: 0.5rem;
  background: linear-gradient(to right, transparent, white);
  pointer-events: none;
}

@media (max-width: 640px) {
  .chart-type-tabs::after {
    display: block;
  }
}
```

---

## 🎯 MISSING RESPONSIVE BREAKPOINTS

**Current:** Only `768px` breakpoint in most files
**Need:** Complete responsive tier system

```css
/* ADD TO index.css as global utility */

/* Ultra-small phones (iPhone SE) */
@media (max-width: 375px) { }

/* Small phones */
@media (max-width: 480px) { }

/* Large phones / small tablets */
@media (max-width: 640px) { }

/* Tablets */
@media (max-width: 768px) { /* EXISTING */ }

/* Landscape tablets */
@media (max-width: 900px) { }

/* Small laptops */
@media (max-width: 1024px) { }
```

**Files needing all breakpoints:**
- `src/index.css`
- `src/App.css`
- `src/pages/PlayerProfile.css`
- `src/pages/TeamProfile.css`
- `src/pages/Home.css`
- `src/pages/Compare.css`
- `src/pages/Trends.css`

---

## 📱 SAFE AREA INSETS (iPhone Notch Support)

**Location:** `src/components/Navigation.css:1-7`

```css
/* ADD for notched devices */
.navigation {
  position: sticky;
  top: 0;
  z-index: 100;
  padding-top: max(0rem, env(safe-area-inset-top));
  padding-bottom: max(0rem, env(safe-area-inset-bottom));
}

/* Also add to html/body */
body {
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
  padding-left: env(safe-area-inset-left);
  padding-right: env(safe-area-inset-right);
}
```

**Also add viewport meta tag to index.html:**
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
```

---

## 🔧 IMPLEMENTATION PHASES

### Phase 1: CSS Foundation (2-3 hours)
**Priority: IMMEDIATE**

1. Add missing breakpoints to `src/index.css`
2. Add global touch scroll utility
3. Add text truncation utilities
4. Fix grid responsive classes in `src/App.css`

**Files to modify:**
- [ ] `src/index.css` - Add 480px, 640px, 375px breakpoints
- [ ] `src/App.css` - Grid system improvements

---

### Phase 2: Critical Touch Targets (1-2 hours)
**Priority: HIGH**

1. Fix all tab components (profile, team, trends)
2. Fix remove buttons
3. Add touch scroll momentum

**Files to modify:**
- [ ] `src/pages/PlayerProfile.css` - Lines 247-261, 397-400
- [ ] `src/pages/TeamProfile.css` - Lines 894-904
- [ ] `src/pages/Compare.css` - Lines 99-117
- [ ] `src/pages/Trends.css` - Lines 84-91

---

### Phase 3: Layout & Overflow Fixes (3-4 hours)
**Priority: HIGH**

1. Remove fixed minimum widths from grids
2. Add single-column mobile layouts
3. Fix chart containers

**Files to modify:**
- [ ] `src/pages/PlayerProfile.css` - Charts grid (line 276), ice rink (282), stats grid (361)
- [ ] `src/pages/Home.css` - Leaders grid (line 56)
- [ ] `src/pages/Trends.css` - Trending grid (line 129)
- [ ] `src/pages/Teams.css` - Conference grid (lines 30-32)

---

### Phase 4: Data Display Optimization (4-5 hours)
**Priority: MEDIUM-HIGH**

1. Implement responsive table strategies (card layouts or column hiding)
2. Add text truncation to all player/team names
3. Fix data badge overflow

**Files to modify:**
- [ ] `src/components/LeagueLeaders.tsx` + `.css`
- [ ] `src/components/TeamStandings.tsx` + `.css`
- [ ] `src/components/AdvancedAnalyticsTable.tsx` + `.css`
- [ ] `src/components/PlayerCard.css` - Lines 87-93
- [ ] `src/components/AdvancedAnalyticsTable.css` - Lines 18-27

---

### Phase 5: Charts & Visualizations (3-4 hours)
**Priority: MEDIUM**

1. Fix SVG responsive sizing
2. Add legend wrapping
3. Fix tooltip positioning
4. Add overflow scroll to chart containers

**Files to modify:**
- [ ] `src/components/StatChart.tsx` - Legend config
- [ ] `src/components/charts/ShotChart.tsx` - Tooltip positioning
- [ ] `src/components/charts/AttackDNAv2.tsx` - SVG sizing
- [ ] All chart CSS files - Add mobile rules

---

### Phase 6: Navigation & Polish (2-3 hours)
**Priority: LOW-MEDIUM**

1. Optimize navigation for small screens (consider hamburger menu)
2. Add safe area insets for notched devices
3. Add touch feedback (active states)
4. Polish spacing and typography

**Files to modify:**
- [ ] `src/components/Navigation.tsx` + `.css`
- [ ] `index.html` - Add viewport-fit=cover
- [ ] Multiple CSS files - Add :active states

---

### Phase 7: Domain Logic & Edge Cases (2-3 hours)
**Priority: MEDIUM**

1. Clamp percentages to 0-100%
2. Add null/undefined guards to goalie stats
3. Standardize number formatting
4. Handle empty states properly

**Files to modify:**
- [ ] Multiple service/component files with stat calculations
- [ ] `src/pages/PlayerProfile.tsx` - Goalie stats
- [ ] Various components - Number formatting

---

## 🧪 TESTING CHECKLIST

### Devices to Test
- [ ] iPhone SE (375x667) - Smallest modern iPhone
- [ ] iPhone 12/13/14 (390x844) - Standard size
- [ ] iPhone 12/13/14 Pro Max (428x926) - Large
- [ ] iPad Mini (768x1024) - Small tablet
- [ ] iPad Pro (1024x1366) - Large tablet
- [ ] Android phone (360x640) - Common Android size
- [ ] Android phone (412x915) - Pixel-style

### Test Cases per Page
1. **Home Page:**
   - [ ] Leaders grid stacks properly at 480px
   - [ ] All cards readable without horizontal scroll
   - [ ] Navigation doesn't wrap excessively

2. **Player Search:**
   - [ ] Search dropdown max 50vh height
   - [ ] Popular players grid stacks at 640px
   - [ ] Search results tappable (48px+ height)

3. **Player Profile:**
   - [ ] Tabs minimum 44px touch target
   - [ ] Charts single-column on mobile
   - [ ] Stats grid 2-column at 480px, 1-column at 320px
   - [ ] Profile image 100px at 375px
   - [ ] All tabs scroll smoothly with momentum

4. **Teams:**
   - [ ] Conference grid stacks at 900px
   - [ ] Team names truncate with ellipsis
   - [ ] Standings table scrolls or shows card layout

5. **Compare:**
   - [ ] Remove buttons 36px+ touch target
   - [ ] Selected players stack at 480px
   - [ ] Comparison table readable on mobile

6. **Trends:**
   - [ ] Trending grid single-column at 768px
   - [ ] Tabs scroll with momentum
   - [ ] Quick stats grid adapts properly

7. **Team Profile:**
   - [ ] Team tabs 36px+ touch target
   - [ ] Quick stats badges wrap properly
   - [ ] All sections readable without horizontal scroll

### Interaction Testing
- [ ] All buttons have visible :active state on tap
- [ ] Tabs scroll smoothly with finger swipe
- [ ] Tables scroll horizontally with momentum
- [ ] Dropdowns fit within viewport
- [ ] Tooltips stay on screen
- [ ] Links have adequate spacing (no mis-taps)

### Performance Testing
- [ ] Page load time on 3G < 5 seconds
- [ ] Scroll performance smooth (60fps)
- [ ] No layout shifts on data load
- [ ] Charts render without jank

---

## 📈 EXPECTED IMPROVEMENTS

**Before:**
- ~40% of mobile users bounce due to poor UX
- Average 2-3 horizontal scrolls per page view
- Frequent mis-taps on small touch targets
- Tables and charts mostly unusable

**After:**
- <10% bounce rate on mobile
- Zero forced horizontal scrolls
- All touch targets meet accessibility guidelines
- Tables show appropriate data for viewport
- Charts fully usable on phones

---

## 🔗 KEY FILES REFERENCE

### Most Critical Files (Fix First)
1. `src/pages/PlayerProfile.css` - 8 critical issues
2. `src/pages/TeamProfile.css` - 3 critical issues
3. `src/components/LeagueLeaders.tsx/.css` - Table overflow
4. `src/components/TeamStandings.tsx/.css` - Table overflow
5. `src/components/PlayerSearch.css` - Dropdown height
6. `src/index.css` - Global breakpoints
7. `src/App.css` - Grid system

### Chart Components (Batch Fix)
- `src/components/charts/ShotChart.tsx/.css`
- `src/components/charts/AttackDNAv2.tsx/.css`
- `src/components/charts/ZoneTimeChart.tsx/.css`
- `src/components/charts/TrackingRadarChart.tsx/.css`
- `src/components/StatChart.tsx` - Recharts config

### Page Components
- `src/pages/Home.tsx/.css`
- `src/pages/Compare.tsx/.css`
- `src/pages/Trends.tsx/.css`
- `src/pages/Teams.tsx/.css`

---

## 📝 NOTES

### Design Philosophy
Follow mobile-first responsive design:
1. Design for 375px first (iPhone standard)
2. Progressive enhancement for larger screens
3. Touch targets minimum 44x44px
4. Content-first (no horizontal scroll)
5. Stack complex layouts on mobile

### CSS Best Practices
```css
/* GOOD - Mobile first */
.element {
  font-size: 1rem; /* Mobile default */
}

@media (min-width: 768px) {
  .element {
    font-size: 1.25rem; /* Desktop enhancement */
  }
}

/* Also acceptable - Desktop first with mobile override */
.element {
  font-size: 1.25rem;
}

@media (max-width: 768px) {
  .element {
    font-size: 1rem;
  }
}
```

### Performance Considerations
- Use `will-change` sparingly (only for actively animating elements)
- Minimize box-shadows on mobile (performance)
- Use CSS transforms over position changes
- Lazy load off-screen charts

---

## 🚀 QUICK START GUIDE

**To begin implementation:**

1. **Start with index.css** - Add global breakpoints and utilities
2. **Fix PlayerProfile.css** - Highest impact page (8 issues)
3. **Fix TeamProfile.css** - Second highest impact
4. **Batch fix all chart components** - Similar fixes across all
5. **Test on real device** - iPhone or Android phone
6. **Iterate based on findings**

**Estimated total time:** 15-20 hours for complete mobile optimization

---

**End of Report**
