# Cold open in a real browser — the live cabinet

Command: `PUP=<dir with puppeteer>/ node scripts/cold-open-time.mjs https://specimen.edycu.dev/ 10`
Run: 2026-11-25 23:24 WIB, headless Chrome (puppeteer), 1440×900, a fresh browser context (empty cache) per run, production deployment `dpl_Hkbr7EKYnqgCHxsZqWm79sU3eLyf`, created 23:10:41 WIB, 12 s after commit 7aa78ec (`vercel inspect`).
Measured: ms from navigation start (network and parse included) to (a) the verdict word on the plate, which is the end of the cold open (lightning lead 620 ms, Reveal of 10 jars 2250 ms, settle 700 ms, count-up 400 ms, plus the in-browser replay), and (b) the "IT'S MOVING" stamp, which appears 700 ms after the first rattled jar is revealed.

Design bound (`COLD_OPEN_BOUND_MS`, apps/cabinet/src/reveal.ts): 4500 ms. Every run is inside it; the largest is 4403 ms, 97 ms under.

Output, pasted unedited:

```
url https://specimen.edycu.dev/ · 1440x900 · 10 fresh-context runs · ms from navigation start
run · DOMContentLoaded · verdict word · stamp
1 · 170 · 4403 · 1971
2 · 161 · 4252 · 1834
3 · 164 · 4254 · 1837
4 · 172 · 4262 · 1844
5 · 163 · 4254 · 1837
6 · 213 · 4320 · 1887
7 · 160 · 4272 · 1822
8 · 155 · 4252 · 1820
9 · 165 · 4259 · 1842
10 · 172 · 4272 · 1838
verdict min 4252 · median 4262 · max 4403
stamp min 1820 · median 1838 · max 1971
```

The jsdom test of the same page (apps/cabinet/test/motion.test.tsx, "Cold-open bound") checks the schedule exactly (620 + 2950 + 400 = 3970 ms, plus the measured replay time, inside 4500) and checks the wall clock under jsdom with a 750 ms render allowance, because jsdom renders the SVG jars more slowly than Chrome and shares the CPU with the rest of the suite.
