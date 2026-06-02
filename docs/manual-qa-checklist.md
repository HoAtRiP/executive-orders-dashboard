# Executive Orders Dashboard Manual QA Checklist

## 1. Dashboard load
- Open the dashboard and confirm the page renders without errors.
- Verify the header, coverage cards, search box, topic dropdown, filters, and table are visible.
- Confirm the About this data toggle is collapsed by default.

## 2. Coverage cards and filters
- Ensure coverage cards display counts for total records, full-text available, metadata-only / missing source, and unknown EO number.
- Click each coverage card and confirm the table updates to show only matching records.
- Confirm the active card is visually highlighted.

## 3. Search behavior
- Enter `Biden` and verify results include Biden-era executive orders.
- Enter `Trump` and verify results include Trump-era executive orders.
- Enter `Obama` and verify results include Obama-era executive orders.

## 4. EO-number search formats
- Search `EO 14406` and verify the specific order appears near the top.
- Search `EO 11100` and verify the correct order appears.
- Test `11100` without the prefix and confirm the same order is still found.

## 5. Full-text search
- Search a term likely found in full-text only (e.g. `climate`) and confirm results include relevant orders.
- Search `cybersecurity` and verify the dashboard matches orders with that topic or text.

## 6. Topic dropdown
- Open the topic dropdown and select `Climate`.
- Confirm the table narrows to climate-related executive orders.
- Open the dropdown and select a different topic to verify filter updates.

## 7. FEMA / acronym search precision
- Search `FEMA` and confirm results are related to FEMA or emergency management.
- Search `female` and verify this does not return only FEMA-related results, demonstrating acronym precision.

## 8. Pagination
- Confirm the table shows paginated results when there are more than one page.
- Navigate to the next page and verify the row range updates.
- Return to the first page and confirm the starting row range resets.

## 9. Sources buttons
- For a row with available sources, confirm the action buttons are present and clickable.
- Verify the `Sources` column label remains visible and functional.
- Confirm rows without source links still render correctly and do not break the layout.

## 10. Show/Hide text preview
- Click `Show text preview` on a row preview and confirm extracted text appears below the title.
- Click `Hide text preview` and verify the preview collapses again.
- Confirm the preview text is a short extracted snippet, not an AI-generated summary.

## 11. About this data toggle
- Click `About this data` and confirm the section expands.
- Verify the expanded text is compact, professional, and readable.
- Click `Hide about this data` and confirm the section collapses.

## 12. Edge cases / no results
- Search `xyznotreal123` and verify the dashboard shows a clear no-results state.
- Confirm topic filters still behave when no search results are present.
- Verify coverage filters still update and do not break the no-results display.
