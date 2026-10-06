# Token Clicker

A browser idle/clicker in the spirit of the classic indie clickers: you hire real AI models, they stand in an office and generate Tokens while the tab is closed. Eight Generations of AI, each transition made through Prestige, while Compute and Perks stay with you forever.

The whole game runs in the browser on React, with no backend and no accounts: progress is saved to that browser's `localStorage`, and the Settings modal can export it as a code and import it back.

> The game itself is played in Russian — that is the shipped player experience. This README is in English for visitors; wherever it points at the interface, the Russian UI label is given in «quotes» so you can find it.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173 (Vite takes the next free port)
npm test         # 432 tests, vitest (16 files)
npm run build    # production bundle (tsc + vite)
```

## How to play

| Action | Where | What it does |
| --- | --- | --- |
| **Click** | «Промпт» (Prompt) column | Send a prompt, get Tokens and a line of Model dialogue |
| **Temperature** | Under the Click button | Drive the heat of the office: more Income, but risk of overheating |
| **Agents** | Shop tab «Модели» (Models) | Buy copies of Models — they generate Income on their own |
| **Upgrades** | Shop tab «Апгрейды» | Income and Click multipliers for the current Run |
| **Prestige** | Shop tab «Престиж» | Reset the Run for Compute and the next Generation |
| **Event** | Over the Scene | Catch the Golden Token while its window is open |
| **Glitch** | The Scene | Three clicks return the Tokens it stole |

Controls: mouse or tap. On a phone the three columns become three tabs at the bottom.

## What's inside

- **Talking Models** — the signature of the game: Models answer in the voice of their Lab, adding «request → reply» pairs to the prompt feed. Collected lines are kept in the «Переписка» (Correspondence) and survive Prestige.
- **Temperature gauge** — the risk-and-reward mechanic: the higher the temperature, the higher the Income (up to ~3x), but heat builds faster and Hallucinations arrive more often. At full Overheat the office cools down and Income drops for a while.
- **Procedural music in the browser** — 8-bit Web Audio with no external audio files: a reactive synth with an arpeggio and bass, whose tempo grows with Income and whose pitch rises 2 semitones with every Generation.
- **Graphics and juicy feedback** — pixel-art Lab mascots, honest hit-stop on click, heat sparks, shimmer over the office, and a careful `reducedMotion` for accessibility.
- **Metrics from Artificial Analysis** — real model characteristics (Intelligence Index, generation speed, API price) in the AA reference.

## Screenshots

![First run in Generation 1: the Token counter and the «Send prompt» button on the left, the Temperature gauge under them, the office in the middle, the Model shop on the right](docs/images/first-run.png)

*First run. The Temperature gauge is ready to be pushed, the Generation goal is named, the first Agent is affordable.*

![Generation 4: the mascots of all eight Labs stand in the office with their Agent counts, the shop shows Model cards with price and Income](docs/images/late-game.png)

*Late game. The office is full of Agents, the Token counter is climbing, the Flagship opens the way to Prestige.*

![Generation 5 in the heat: the Temperature gauge in the «Almost overheating» zone, the Overheat bar at 85%, the whole interface and office glowing hot](docs/images/hot.png)

*The heat at the end of the gauge. Income tripled, the office is red-hot, and the Overheat needs urgent cooling.*

![Shop tab «Модели»: Model cards with the Lab Mascot, Rank, price, Income and Agent count](docs/images/shop-models.png)

*The Model shop with its 12-tick goal rails and a compact Artificial Analysis reference.*

## Data and attribution

Model metrics are pinned as a snapshot (`src/data/aa-snapshot.json`). The Artificial Analysis API key never reaches the client bundle; the attribution stays visible in the footer and in the shop.
