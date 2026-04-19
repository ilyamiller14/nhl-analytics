# Player Comparison Scenario

## Scenario 1: Compare Elite Centers (Core Happy Path)

**Context**:
A fantasy hockey manager needs to decide between Connor McDavid, Nathan MacKinnon, and Auston Matthews for their draft. They want to compare current season performance across key metrics.

**User Journey**:
1. User navigates to `/compare` page
2. Types "McDavid" in search box
3. Sees dropdown with Connor McDavid (EDM, C) at top
4. Clicks on Connor McDavid → card appears in "Selected Players (1/4)"
5. Types "MacKinnon" → selects Nathan MacKinnon (COL, C)
6. Types "Matthews" → selects Auston Matthews (TOR, C)
7. Sees all three players displayed side-by-side with default metrics
8. Clicks "Metric Selector" to customize view
9. Toggles to show: Goals, Assists, Points, +/-, PPG, Shots, TOI
10. Views comparison table with all three players
11. Identifies Matthews has most goals, McDavid has most assists
12. Takes screenshot to share with league

**Expected Outcomes**:

### Data Accuracy
- ✅ All player stats are for **current season (2024-25)**
- ✅ Stats match official NHL.com numbers
- ✅ Position displayed correctly (all show "C" for center)
- ✅ Team abbreviations correct (EDM, COL, TOR)
- ✅ Player headshots load (or graceful fallback if missing)

### Performance
- ✅ Search autocomplete appears **< 200ms** after typing stops
- ✅ Player card appears **< 500ms** after selection (with loading state)
- ✅ Stats loaded from cache on second view **< 100ms**
- ✅ No UI freeze when loading multiple players
- ✅ Smooth scrolling on mobile devices

### User Experience
- ✅ Search results sorted by relevance (McDavid before McDonald)
- ✅ Active players prioritized (inactive players filtered out)
- ✅ Can't add same player twice (selection disabled)
- ✅ Clear "X" button on each player card to remove
- ✅ "Clear All" button to reset comparison
- ✅ Player count shown: "Selected Players (3/4)"

### Metric Selector
- ✅ Default metrics displayed without user interaction
- ✅ Can toggle metrics on/off with checkboxes
- ✅ At least 5 metrics always visible (not all unchecked)
- ✅ Metric changes update table immediately (no page reload)
- ✅ Selected metrics persist if user removes/adds players

### Responsive Design
- ✅ Works on desktop (1920x1080)
- ✅ Works on tablet (768x1024)
- ✅ Works on mobile (375x667) - cards stack vertically
- ✅ Headshots scale appropriately
- ✅ Table scrolls horizontally on small screens

---

## Scenario 2: API Failure During Comparison

**Context**:
User is building a comparison when NHL API experiences downtime.

**User Journey**:
1. User has already added McDavid and MacKinnon (cached)
2. User searches for "Matthews"
3. NHL API times out (5+ second delay)
4. User sees loading spinner but **not** an error immediately
5. System retries in background (exponential backoff: 1s, 2s, 4s)
6. After 3 attempts (total ~10 seconds), user sees friendly message
7. Matthews card shows: "Unable to load Matthews. Retry?"
8. User clicks "Retry" button
9. API has recovered, Matthews loads successfully

**Expected Outcomes**:

### Error Handling
- ✅ **No raw error messages** shown to user (not "TypeError: Cannot read property...")
- ✅ User sees: "Unable to load player data. Retrying..." with spinner
- ✅ Retry happens automatically (3 attempts with exponential backoff)
- ✅ If all retries fail, show: "Unable to load [Player Name]. Please try again."
- ✅ Manual "Retry" button provided
- ✅ Other players (cached) remain visible and functional

### System Behavior
- ✅ Search still works (doesn't break entire page)
- ✅ Previously loaded players still display correctly
- ✅ User can remove problematic player and try another
- ✅ Retry uses exponential backoff: **1000ms, 2000ms, 4000ms**
- ✅ Total timeout: **10 seconds** before showing error
- ✅ Each retry logged to console (for debugging)

### Graceful Degradation
- ✅ If NHL API down, show cached data with "(Last updated: 2 hours ago)"
- ✅ If no cached data, show partial card: name, team, position (from search result)
- ✅ Stats section shows: "Stats temporarily unavailable"
- ✅ Comparison still shows what's available for other players

**Pattern to Use**: `~/.claude-factory/patterns/resilience/exponential-backoff/`

---

## Scenario 3: Edge Cases and Limits

**Context**:
User tries various edge cases to test the comparison tool.

**Test Cases**:

### A. Maximum Players (4 Limit)
1. User adds McDavid, MacKinnon, Matthews, Draisaitl (4 players)
2. Tries to add 5th player (Panarin)
3. Sees alert: "Maximum 4 players can be compared at once"
4. Can remove one player to make room
5. Then successfully add Panarin

**Expected**: ✅ Limit enforced, clear message, easy to resolve

### B. Duplicate Player
1. User adds Connor McDavid
2. Searches for "McDavid" again
3. Connor McDavid appears in results but **grayed out** or disabled
4. Clicking does nothing (or shows tooltip: "Player already selected")

**Expected**: ✅ Can't add duplicates, UI prevents it clearly

### C. Search with < 2 Characters
1. User types "M" (1 character)
2. No search request sent (prevents noise)
3. User types "Mc" (2 characters)
4. Search activates, shows results

**Expected**: ✅ Minimum 2 characters required, no unnecessary API calls

### D. No Results Found
1. User types "XYZ123" (nonsense)
2. Sees: "No players found matching 'XYZ123'"
3. Suggestion: "Try searching by first or last name"

**Expected**: ✅ Clear feedback, helpful guidance

### E. Inactive Player Search
1. User types "Gretzky"
2. Wayne Gretzky appears but marked "Retired" or filtered out
3. Only active players shown by default
4. (Optional) Toggle to include retired players

**Expected**: ✅ Active players prioritized, clear status

### F. Special Characters in Search
1. User searches for "Timo Meier"
2. Player found correctly
3. User searches for "Tomáš Hertl" (accented characters)
4. Player found (NHL API handles unicode)

**Expected**: ✅ Handles spaces, accents, special characters

---

## Scenario 4: Mobile Experience

**Context**:
User on iPhone 13 (375x812) wants to compare players on the go.

**User Journey**:
1. User opens app on mobile browser
2. Search box is full-width, easy to tap
3. Keyboard appears immediately on focus
4. Search results are finger-friendly (large tap targets)
5. Selected player cards stack vertically
6. Can scroll through comparison table horizontally
7. "Clear All" button accessible without scrolling

**Expected Outcomes**:
- ✅ Touch targets **minimum 44x44px** (Apple guidelines)
- ✅ No horizontal scroll required to access controls
- ✅ Player cards responsive: full width on mobile
- ✅ Table scrolls smoothly with momentum
- ✅ Headshots don't break layout (proper sizing)
- ✅ Metric selector opens as modal/drawer (not inline)
- ✅ Text readable without zooming (16px minimum)

---

## Scenario 5: Shareable Comparisons

**Context**:
User wants to share their comparison with a friend.

**User Journey**:
1. User compares McDavid, MacKinnon, Matthews
2. Copies URL from browser: `/compare?players=8478402,8477492,8479318`
3. Sends link to friend
4. Friend opens link → sees exact same comparison
5. All three players load automatically
6. Same metrics displayed

**Expected Outcomes**:
- ✅ URL includes player IDs: `/compare?players=ID1,ID2,ID3`
- ✅ Opening URL auto-loads those players
- ✅ Works with 1-4 players in URL
- ✅ Invalid player IDs gracefully ignored
- ✅ Metrics selection **optionally** encoded in URL
- ✅ Works on mobile (shareable via message, social media)

---

## Scenario 6: Real-Time Season Updates

**Context**:
During season, player stats update after each game.

**User Journey**:
1. User compares players at 3pm (before game)
2. McDavid has 50 goals
3. McDavid scores in game at 7pm
4. User returns to comparison page at 10pm
5. McDavid now shows 51 goals
6. No manual refresh needed

**Expected Outcomes**:
- ✅ Stats cached for **5 minutes** (reasonable freshness)
- ✅ After cache expires, new API call fetches updated stats
- ✅ React Query handles cache invalidation automatically
- ✅ User sees loading indicator during update (subtle, non-intrusive)
- ✅ If user actively viewing, show toast: "Stats updated" (optional)

---

## Validation Methods

### Automated Testing
```bash
# E2E tests (Playwright)
npm run test:e2e

# Test scenarios:
1. Add 3 players successfully
2. Verify stats match API response
3. Test 4-player limit
4. Test duplicate prevention
5. Test API failure handling
6. Test mobile responsive layout
```

### Manual QA Checklist
- [ ] Search autocomplete works (< 200ms)
- [ ] Player cards load with data
- [ ] Comparison table displays correctly
- [ ] Metric selector toggles work
- [ ] API failures show friendly errors
- [ ] Mobile layout is usable
- [ ] URL sharing works
- [ ] Performance acceptable (no lag)

### LLM Code Review
Ask Claude to review:
1. **Security**: Input sanitization in search (XSS prevention)
2. **Performance**: Unnecessary re-renders, optimization opportunities
3. **Accessibility**: ARIA labels, keyboard navigation
4. **Error Handling**: All edge cases covered?
5. **Type Safety**: TypeScript types correct for API responses

### Load Testing
- 100 concurrent users comparing players
- API responses cached appropriately
- No memory leaks with long sessions

---

## Success Criteria

This feature is **successful** when:

1. ✅ **95%+ of comparisons complete < 2 seconds** (cached or fresh)
2. ✅ **Zero errors** for valid player searches
3. ✅ **Graceful degradation** when NHL API is down (shows cached data)
4. ✅ **Mobile-friendly** (works on phones without frustration)
5. ✅ **Shareable** (URL-based, can send to friends)
6. ✅ **Accurate** (stats match NHL.com)
7. ✅ **Accessible** (keyboard navigable, screen reader friendly)

## Integration Points

### Required Services
- [src/services/nhlApi.ts](../src/services/nhlApi.ts) - Player search, player info
- [src/hooks/usePlayerStats.ts](../src/hooks/usePlayerStats.ts) - Stats fetching with React Query
- [src/context/ComparisonContext.tsx](../src/context/ComparisonContext.tsx) - State management

### Patterns to Apply
- `~/.claude-factory/patterns/resilience/exponential-backoff/` - API retry logic
- `~/.claude-factory/patterns/security/input-validation/` - Search input sanitization

### Future Enhancements
- Export comparison as image/PDF
- Save comparisons to user account (requires auth)
- Compare players across different seasons
- Add advanced metrics (xG, Corsi, Fenwick)
- Player comparison head-to-head matchups
