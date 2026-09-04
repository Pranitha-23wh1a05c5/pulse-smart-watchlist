# Pulse — Smart Watchlist

Pulse is a live market watchlist built around a simple idea:

> Instead of showing you everything happening in the market, Pulse tries to tell you what actually deserves your attention.

It combines market movement, unusual activity, sector-level movement, data-quality checks, personal investment beliefs, and a Devil's Advocate feature that challenges the user's own thinking.

---

# Setup Instructions

Follow these steps in order.

## 1. Download the ZIP file

Download the Pulse Smart Watchlist ZIP file to your computer.

## 2. Extract the ZIP file

Right-click the ZIP file and select **Extract All**.

After extraction, you should have a folder similar to:

```text
smart-watchlist/
├── backend/
├── frontend/
├── .gitignore
└── README.md
```

## 3. Open the folder in VS Code

Open Visual Studio Code.

Select:

**File → Open Folder**

Then select the extracted `smart-watchlist` folder.

## 4. Open the VS Code terminal

Open:

**Terminal → New Terminal**

Move into the backend folder:

```bash
cd backend
```

## 5. Install the required packages

Run:

```bash
npm install
```

Wait until the installation is complete.

## 6. Start the application

Run:

```bash
npm start
```

Keep this terminal open and running.

The application will be available at:

```text
http://localhost:4000
```

## 7. Set up Ollama

Open a second terminal in VS Code.

Run:

```bash
ollama pull llama3.2
```

Wait until the model download reaches 100%.

After it finishes, run:

```bash
ollama list
```

If `llama3.2` appears in the table, the model is installed correctly.

For example:

```text
NAME       ID       SIZE
llama3.2   ...      ...
```

If Ollama is not already running, start it with:

```bash
ollama serve
```

Ollama is optional for the application itself. Without Ollama, Pulse still works and uses its built-in template-based Devil's Advocate. Ollama enables the real AI-generated Devil's Advocate responses.

## 8. Open Pulse

Go back to the first terminal where you ran:

```bash
npm start
```

Open:

```text
http://localhost:4000
```

in your browser.

After opening the application, refresh the browser twice.

The application is now ready to use.

---

# What Pulse Does

Pulse is not designed to be just another stock-price dashboard.

A normal watchlist might show:

- Stock price
- Percentage change
- Charts
- Volume

Pulse asks a different question:

> "Did something happen that is unusual enough that I should pay attention to it?"

It therefore looks at a stock relative to its own normal behavior rather than treating every percentage move as equally important.

For example, a 1% move in one stock might be completely normal, while a 1% move in another stock might be unusually large.

Pulse uses several signals together to determine how much attention a stock deserves.

---

# 1. Attention Score

Every stock receives an Attention Score from 0 to 100.

The default watchlist is sorted by Attention Score so that the stocks with the most unusual activity can appear first.

The score combines four main signals.

## Surprise

Pulse checks how unusual the latest price movement is compared with that particular stock's normal volatility.

This is based on a statistical measurement called a z-score.

In simple terms:

> "Is this stock moving more than it normally moves?"

A large move in a normally stable stock can therefore receive more attention than the same move in a highly volatile stock.

## Volume Spike

Pulse compares the current volume with the stock's recent average volume.

For example:

```text
Normal volume: 1 million
Current volume: 3 million
```

The unusually high volume can increase the Attention Score because more activity may indicate that something important is happening.

## Range Position

Pulse checks where the current price sits inside its tracked recent price range.

For example, it can identify whether a stock is:

- Near the top of its range
- Near the bottom of its range
- Somewhere in the middle

This provides context for the current price movement.

## Jump Detection

Pulse also looks for sudden large movements over the most recent ticks.

This helps identify rapid changes that may deserve immediate attention.

---

# 2. Explanations

Pulse does not only show a number.

It also explains why a stock received attention.

For example, an explanation can combine information such as:

```text
AAPL is up 1.2%, roughly 2x its normal volatility,
on 2.3x average volume, near the top of its range.
```

This makes the Attention Score easier to understand.

The explanation is generated from the same underlying metrics used by the scoring system.

It does not require an LLM, which makes the explanation fast, inexpensive, and easier to trace back to the actual market signals.

---

# 3. Thesis Tracking

One of the main ideas behind Pulse is that investors do not just watch the market.

They also have beliefs about what they think will happen.

When a user adds a stock, Pulse asks the user to explain their view in one sentence.

For example:

```text
I believe NVDA has strong long-term growth potential because AI demand will continue increasing.
```

The user also chooses a stance:

- Bullish
- Bearish
- Watching

## Bullish

Bullish means:

> "I believe the stock is likely to increase."

## Bearish

Bearish means:

> "I believe the stock is likely to decrease."

## Watching

Watching means:

> "I am interested in the stock, but I have not taken a clear position."

Pulse then tracks whether the actual market movement agrees with the user's stated belief.

This changes the purpose of the watchlist from simply tracking stocks to also tracking the user's own assumptions.

---

# 4. Thesis Status

Every thesis can have one of four statuses.

## Pending

The thesis has not been tested yet.

The market has not moved enough in either direction to determine whether the user's belief is being supported or challenged.

## Confirmed

The thesis is considered confirmed when the price moves at least 3% in the user's favor.

For example:

If the user is bullish and the stock rises by at least 3%, the thesis can become confirmed.

## Contradicted

The thesis is considered contradicted when the price moves at least 3% against the user's position.

For example:

If the user is bullish and the stock falls by at least 3%, the thesis can become contradicted.

This is important because Pulse gives more attention to a belief that may have been proven wrong than to an ordinary price movement.

## Stale

A thesis becomes stale when 14 days pass without a meaningful test in either direction.

This is a reminder that the user is still holding an opinion that has not actually been tested by the market.

---

# 5. Devil's Advocate

The Devil's Advocate is one of the main differentiating features of Pulse.

Its purpose is to challenge the user's investment thinking rather than simply agree with it.

For example, suppose the user says:

```text
I believe NVDA has strong long-term growth potential.
```

and selects:

```text
Bullish
```

The Devil's Advocate takes the opposite side.

Instead of saying:

```text
NVDA is doing well and your thesis looks good.
```

it asks:

```text
What could make this bullish thesis wrong?
```

The feature is designed to reduce confirmation bias.

Confirmation bias happens when someone pays more attention to information that supports what they already believe and ignores information that challenges it.

Pulse deliberately introduces an opposing argument.

---

# 6. AI-Generated Devil's Advocate

Pulse can use Ollama and the `llama3.2` model to generate a real AI-based Devil's Advocate response.

The setup is local:

```bash
ollama pull llama3.2
```

No API key is required for the Ollama setup.

When Ollama is available, Pulse can generate responses based on the user's thesis and the current market context.

The interface identifies these responses as:

```text
Devil's advocate (AI-generated)
```

---

# 7. Template-Based Devil's Advocate

Pulse does not depend completely on an AI model.

If Ollama is unavailable, the application falls back to a built-in template system.

The template system uses keywords and actual market metrics to generate a counter-argument.

For example, a bullish thesis combined with a stock near the top of its recent range can produce an argument that the same position may also be where a reversal could begin.

This fallback makes the feature resilient.

The application can continue working even when:

- Ollama is not installed
- Ollama is not running
- The model is unavailable
- An LLM request is slow
- An LLM request fails

The user can therefore still use the Devil's Advocate feature without depending completely on an external AI service.

---

# 8. Real Market Data

Pulse attempts to use real market data first.

The backend fetches delayed market quotes from Yahoo Finance's public chart endpoint.

No market-data API key is required for this feed.

The market engine periodically checks the symbols in the user's watchlist.

---

# 9. Automatic Real-to-Simulated Data Fallback

Real market data can sometimes become unavailable.

For example, the data source may:

- Rate-limit requests
- Reject a request
- Be unavailable on a particular network
- Be blocked by a corporate proxy or sandbox

Instead of stopping the application, Pulse can automatically switch an affected symbol to a simulated random-walk feed.

The application continues trying to retrieve real data in the background.

When real data becomes available again, the symbol can automatically return to real data.

This fallback happens independently for each symbol.

---

# 10. Data Source Badges

Pulse clearly shows which type of data is being used.

A stock can display:

```text
Live · Yahoo
```

or:

```text
Simulated
```

This prevents the user from accidentally assuming that simulated movement is a real market quote.

The application also shows an overall status banner describing how many symbols are currently using real versus simulated data.

When simulated data is used, generated explanations explicitly indicate that the data is simulated.

---

# 11. Delayed, Conflicting, and Closed Data

Pulse treats data quality as an important part of the product.

## Delayed

If a real quote has not been updated recently, Pulse can mark it as delayed.

## Conflicting

Pulse compares the headline market price with recent intraday candle information.

If the two sources disagree in a meaningful way, Pulse can flag the symbol as conflicting.

This prevents the application from confidently reasoning from a potentially stale or inconsistent value.

## Closed

Outside regular U.S. market hours, real symbols can appear essentially flat and receive a Closed status.

This is expected behavior because the market is not actively trading.

Pulse does not try to create artificial movement simply to make the chart look active.

---

# 12. Dual-Feed Reconciliation

The application uses two sources of information to identify possible data problems.

For simulated symbols, Pulse also maintains two independent synthetic feeds.

One feed is used for scoring.

The other acts as a comparison source and can intentionally lag or diverge.

This allows the application to demonstrate how the interface behaves when data sources disagree, even when the application is running without network access.

An important design decision is that the secondary source is not used to calculate the Attention Score.

It can trigger a warning such as a conflicting-data badge, but it cannot create a false attention alert.

---

# 13. Digest — "Since You Last Checked"

Pulse does not simply show everything that happened since the last page refresh.

Instead, it maintains a snapshot of the user's previous acknowledged state.

When the user opens the application, Pulse compares the current state against that previous snapshot.

It then shows meaningful changes since the user last acknowledged the digest.

For example:

```text
3 hours ago
NVDA moved significantly and your bullish thesis was challenged.
```

The wording changes based on how much time has passed.

A quiet day can therefore produce a small or empty digest rather than a wall of unnecessary notifications.

---

# 14. Explicit Digest Acknowledgment

The digest has an important behavior.

The previous snapshot is updated only when the user explicitly acknowledges the digest.

A simple browser refresh does not erase the changes.

This means:

```text
Page refresh
    ↓
Digest remains available
    ↓
User reads it
    ↓
User acknowledges it
    ↓
New baseline is saved
```

This prevents a background refresh or accidental reload from silently removing information the user has not yet seen.

---

# 15. Digest Priority for Investment Beliefs

Pulse gives special importance to changes involving the user's thesis.

For example:

```text
Normal price movement
```

is useful.

But:

```text
Your bullish thesis has been contradicted
```

is potentially much more important.

A thesis changing from pending to contradicted therefore receives additional Attention Score weight and is prioritized in the digest.

The application gives:

- +15 for a contradicted thesis
- +5 for a stale thesis

This makes the system focus not only on what the market did, but also on whether something happened that challenges the user's assumptions.

---

# 16. Sector-Level Insights

Sometimes several stocks move together.

For example:

```text
NVDA      down
AMD       down
AVGO      down
```

If these companies belong to the same sector, the movement may represent a broader sector-level event rather than three unrelated stock movements.

Pulse detects when multiple watchlist symbols in the same sector move in the same direction.

It then creates a separate sector insight.

This helps distinguish:

```text
One stock is moving.
```

from:

```text
Several stocks in the same sector are moving together.
```

---

# 17. Per-Symbol Sensitivity

Not every user wants the same level of alerts for every stock.

Pulse therefore allows sensitivity to be configured for each symbol.

The available levels are:

- Low
- Normal
- High

For example, a user might want:

```text
TSLA → Low sensitivity
KO   → High sensitivity
```

This means the user can decide that only very large movements in one stock deserve attention while relatively small unusual movements in another stock should be highlighted.

The idea is that "meaningful" is personal rather than identical for every stock.

---

# 18. Live Sparklines

Each watchlist card includes a small live price chart, or sparkline.

The sparkline gives the user a quick visual understanding of the recent direction and movement of the stock without requiring a large chart.

The interface also uses a visual flash/pulse effect when live ticks arrive so the watchlist feels active rather than static.

---

# 19. Automatic Watchlist Sorting

The default sorting method is:

```text
Attention Score
```

This means the watchlist prioritizes unusual activity rather than simply sorting alphabetically or by percentage change.

Users can change the sorting method using the sort control.

When only one stock is being watched, the interface explicitly explains that there is nothing to reorder.

---

# 20. Cross-Device and Cross-Session Sync

Pulse does not require a traditional signup system.

There is:

- No email registration
- No password
- No traditional account signup

Instead, Pulse generates a memorable watchlist code such as:

```text
SWIFT-FALCON-42
```

The code acts as the account key.

The user can enter the same code on another device to access the same:

- Watchlist
- Settings
- Investment theses
- Digest baseline

This provides a simple cross-device persistence model without building a complete authentication system.

---

# 21. Persistence

Pulse stores user state so that the application can remember information between sessions.

The current implementation uses JSON-file persistence.

This keeps the project simple and easy to understand for a demo.

The persistence layer is designed so that it can later be replaced with a database such as PostgreSQL without changing the rest of the application architecture significantly.

---

# 22. Per-User Write Serialization

Pulse also protects user data when multiple requests happen at the same time.

For example, a user might have:

- Two browser tabs open
- A settings change happening
- A thesis being saved
- An LLM request taking several seconds

The application uses a per-user lock so that changes for the same user are processed one at a time in the correct order.

This prevents simultaneous updates from overwriting each other or producing inconsistent user state.

---

# 23. Regression Tests

The backend contains a small dependency-free test suite.

It uses Node's built-in `assert` functionality.

The tests focus on bugs and reasoning-heavy areas that were specifically encountered during development.

To run the tests:

```bash
cd backend
node test.js
```

The tests include checks for issues such as:

- Incorrect keyword matching
- Incorrect sensitivity multiplier direction
- Other important behavior in the reasoning-related parts of the application

This is not intended to provide complete application test coverage. It is a focused regression suite for areas where subtle logic errors are most likely.

---

# 24. No Build Step for the Frontend

The frontend is intentionally simple.

It uses:

- HTML
- CSS
- Vanilla JavaScript

There is no frontend build step.

The main frontend files are:

```text
frontend/
├── index.html
├── style.css
└── app.js
```

This keeps the application easy to run and easy to inspect.

---

# 25. Backend Architecture

The backend contains the main application logic.

Important files include:

```text
backend/
├── server.js
├── marketEngine.js
├── changeEngine.js
├── db.js
├── symbols.js
├── thesisThemes.js
└── test.js
```

## server.js

Provides the REST API and WebSocket wiring.

It connects the frontend to the backend services.

## marketEngine.js

Handles the market feed, including simulated data and data-source reconciliation.

## changeEngine.js

Handles:

- Attention Score
- Digest calculations
- Meaningful-change detection
- Sector insights
- Related market reasoning

## db.js

Handles persistence of user and watchlist state.

The current implementation uses JSON-file storage.

## symbols.js

Contains the demo symbol catalog and related information such as sector and volatility.

## thesisThemes.js

Contains keyword-theme matching used by the template-based Devil's Advocate system.

Keeping this logic in its own module makes it easier to understand and test independently.

## test.js

Contains the focused regression tests for important reasoning-related behavior.

---

# 26. Project Structure

The complete project is organized approximately like this:

```text
smart-watchlist/
│
├── backend/
│   ├── server.js
│   ├── marketEngine.js
│   ├── changeEngine.js
│   ├── db.js
│   ├── symbols.js
│   ├── thesisThemes.js
│   └── test.js
│
├── frontend/
│   ├── index.html
│   ├── style.css
│   └── app.js
│
├── .gitignore
└── README.md
```

---

# 27. How the Main Features Work Together

The application can be understood as a sequence:

```text
Market Data
     ↓
Data Quality Checks
     ↓
Attention Score
     ↓
Plain-English Explanation
     ↓
Digest and Sector Insights
     ↓
User's Investment Thesis
     ↓
Thesis Status
     ↓
Devil's Advocate
```

The important point is that these features are connected.

Pulse is not simply calculating a stock's percentage change.

It considers:

```text
What happened?
      +
Was it unusual?
      +
Is the data reliable?
      +
Is there a broader sector movement?
      +
What did the user believe would happen?
      +
Did reality support or contradict that belief?
```

That combination is the core idea behind the project.

---

# 28. Why Pulse Is Different From a Normal Watchlist

A traditional watchlist focuses mainly on the market:

```text
What is the price?
How much did it change?
What is the chart doing?
```

Pulse adds another dimension:

```text
What did I believe?
What actually happened?
Did reality agree with me?
Could I be wrong?
```

This makes the product less about constantly watching stock prices and more about recognizing meaningful changes and challenging the user's assumptions.

The goal is not to tell the user what to buy or sell.

The goal is to help the user notice when something important happened and to encourage them to question their own investment thesis.

---

# 29. Scaling the Application

The current implementation is designed for a demo and small number of users, but the architecture leaves clear paths for scaling.

## Persistence

The JSON storage can eventually be replaced with PostgreSQL.

Possible tables include:

```text
users
watchlist_items
settings
```

The existing persistence interface can remain largely the same.

## Market Data

Currently, connected browsers can share the same in-process market engine.

At larger scale, Redis or a similar messaging system could be used so that multiple backend instances can share market-data subscriptions and computations.

## WebSocket Fan-Out

At demo scale, broadcasting updates to connected clients is sufficient.

At larger scale, updates can be filtered server-side so each client receives only the symbols in its own watchlist.

## Attention Scoring

The Attention Score operates using rolling windows rather than rescanning the entire history for every tick.

This keeps the per-symbol calculation efficient as the application grows.

---

# 30. Design Philosophy

Several parts of Pulse were intentionally kept simple.

## No Brokerage Integration

The project does not connect to a brokerage account.

Adding brokerage or production market-data integrations would introduce API keys, authentication, vendor limits, and other infrastructure without changing the central product idea.

## No Traditional Authentication

The watchlist-code system provides persistence and cross-device behavior without requiring a full email/password authentication system.

## JSON Persistence

JSON storage is used instead of immediately introducing a production database.

This makes the project easier to understand, run, and demonstrate.

For production scale, a database would be the natural next step.

---

# 31. Optional Demo Mode

Pulse can be forced into simulated-data mode using:

```text
PULSE_MODE=simulated
```

This can be useful when:

- A network cannot reach Yahoo Finance
- Real market data is not required
- A predictable demo environment is preferred

The rest of the application continues using the same Attention Score, digest, explanation, and insight logic.

---

# 32. Important Note About Market Data

Real market quotes are delayed and can occasionally be unavailable.

Pulse therefore clearly identifies whether a symbol is using:

```text
Live · Yahoo
```

or:

```text
Simulated
```

The simulated feed is intended for demonstration purposes and should not be interpreted as a real market quote.

---

# Summary

Pulse is a smart watchlist that combines market monitoring with personal thesis tracking.

Its main features are:

1. Attention Score based on unusual market behavior
2. Plain-English explanations for why a stock deserves attention
3. Bullish, bearish, and watching investment stances
4. Thesis tracking
5. Pending, confirmed, contradicted, and stale thesis states
6. Devil's Advocate reasoning
7. AI-generated Devil's Advocate using Ollama
8. Template-based Devil's Advocate fallback
9. Real Yahoo Finance market data
10. Automatic real-to-simulated data fallback
11. Live, simulated, delayed, conflicting, and closed data indicators
12. Dual-feed data reconciliation
13. "Since you last checked" digest
14. Explicit digest acknowledgment
15. Thesis changes prioritized in the digest
16. Sector-level movement detection
17. Per-symbol sensitivity
18. Live sparklines
19. Attention-based watchlist sorting
20. Cross-device watchlist synchronization
21. Persistent user state
22. Per-user write serialization
23. Focused regression tests
24. Simple vanilla JavaScript frontend
25. Clear backend separation
26. A design that can be scaled toward PostgreSQL, Redis, and production market-data infrastructure

The central idea is simple:

> **Don't just watch the market. Watch what changed, understand why it matters, and notice when reality challenges what you believed.**
