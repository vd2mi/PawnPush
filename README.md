```markdown
# PawnPush

PawnPush is an interactive chess puzzle platform designed to help players improve their skills through a vast collection of puzzles. Accessible online at [https://pawn-push.vercel.app](https://pawn-push.vercel.app), it offers categorized puzzles, AI-powered hints, and a coaching chat for personalized guidance.

## Features

- Multiple difficulty levels: Beginner, Intermediate, Advanced, Grand Master
- Various position types: Opening, Middlegame, Endgame, Checkmate
- Interactive chessboard with move validation
- Hint system powered by GPT-4 API
- Over 50,000 puzzles stored in a comprehensive database
- AI coaching chat for tailored hints and explanations
- Responsive and user-friendly interface

## Technologies Used

- **Frontend:** HTML, CSS, JavaScript
- **Chessboard UI:** [Chessboard.js](https://chessboardjs.com/)
- **Chess Logic:** [chess.js](https://github.com/jhlywa/chess.js)
- **AI Integration:** GPT-4 via serverless API
- **Server-side:** Node.js with [Next.js API routes](https://nextjs.org/docs/api-routes/introduction)
- **Dependencies:** node-fetch, stockfish.js

## File Structure

```

PAWN PUSH/
│
├── api/
│   └── getHint.js            # Serverless API for AI hints
│
├── index.html                 # Main HTML page
├── puzzle.html                # Puzzle interface page
├── puzzle\_summary.json        # Puzzle data and summaries
├── puzzles.json               # Full puzzles database
│
├── IndexScript.js             # Main site logic
├── PuzzleScript.js            # Puzzle-specific logic
│
├── style.css                  # Stylesheet
├── package.json               # NPM dependencies
├── package-lock.json          # Lockfile

````

## Setup Instructions

### Prerequisites

- Node.js version 12 or higher
- OpenAI API key (sign up at [OpenAI](https://platform.openai.com/))

### Installation

1. Clone the repository:

```bash
git clone <your-repo-url>
cd PawnPush
````

2. Install dependencies:

```bash
npm install
```

3. Configure environment variables:

Create a `.env` file in the root directory:

```env
OPENAI_API_KEY=your-openai-api-key
```

4. Run the development server:

```bash
npm run dev
```

The app will be available locally at `http://localhost:3000`.

## Usage

* Visit [https://pawn-push.vercel.app](https://pawn-push.vercel.app) to play directly.
* Select difficulty and position type, then start solving puzzles.
* Use the interactive chessboard to make moves.
* Click "Hint" for AI suggestions.
* Engage with the coaching chat for guidance.
* Complete puzzles and progress through the database.

## How it Works

* The `getHint.js` API uses GPT-4 to analyze the current puzzle and provide guidance.
* Optional integration with Stockfish allows checking the best move.
* The frontend uses `chess.js` for move validation and `chessboard.js` for UI rendering.

## Contributing

Contributions are welcome! Fork the repository and submit pull requests with improvements.

## Live Website

[https://pawn-push.vercel.app](https://pawn-push.vercel.app)

```
```
