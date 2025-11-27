# PawnPush ♟️

A production-grade chess training platform with 50,000+ pre-evaluated puzzles, agentic AI coaching, and serverless game analysis. Built from scratch with custom APIs, batch-mode Stockfish integration, and real-time multiplayer synchronization.

**Live:** [https://pawn-push.vercel.app](https://pawn-push.vercel.app)

---

## Executive Summary

PawnPush is a full-stack chess puzzle platform featuring custom-built serverless APIs for AI coaching and game analysis. The system processes positions through a batch-mode Stockfish engine (4 parallel workers, depth 18, multiPV 3), persistent global caching, and GPT-4.1-mini agentic reasoning with tactical pattern detection. Firebase powers real-time 1v1 battles with 6-digit private rooms.

**Technical Highlights:**
- Custom serverless API layer handling GPT-4.1-mini coaching, HuggingFace Stockfish batch processing, and Firebase real-time sync
- Batch-mode game analysis with persistent global caching and 132K+ opening book positions (ECO A-E + interpolated)
- Agentic AI coach using multi-step reasoning, tool calling, and tactical pattern detection (forks, pins, skewers, hanging pieces)
- Real-time multiplayer using Firebase Firestore with room state management and live score synchronization
- Production-grade evaluation engine with mate sorting, POV-aware conversion, and Stockfish-like ACPL/accuracy formulas

---

## Core Features

### 🎯 Puzzle System
- **50,000+ pre-evaluated puzzles** with optimal side selection and smart orientation
- **Daily puzzles** from Lichess API with animated ratings
- **Difficulty tiers:** Beginner (800-1200) → Intermediate (1200-1600) → Advanced (1600-2000) → Grand Master (2000+)
- **Position types:** Opening, Middlegame, Endgame, Checkmate
- **Survival mode** with lives system and progressive difficulty

### 🤖 Agentic AI Coach
- **Multi-step reasoning** using GPT-4.1-mini with tool calling for position analysis
- **Stockfish integration** via HuggingFace API (depth 18, multiPV 3) for engine-backed explanations
- **Tactical pattern detection:** Automatic identification of forks, pins, skewers, hanging pieces, overloaded pieces
- **Position facts engine:** Pseudo-legal attack maps, defense maps, and threat analysis
- **Safe response system:** Verification layer prevents hallucinated moves, squares, or invalid tactics
- **Progressive hints** with visual yellow glow cues and contextual coaching

### 📊 Game Analysis
- **Unified batch-mode architecture:** Frontend sends FEN history → Backend performs 100% engine work
- **HuggingFace Stockfish batch API:** 4-engine parallel processing at depth 18, multiPV 3
- **Persistent global caching:** `global.EVAL_CACHE` persists across serverless requests, eliminating redundant API calls
- **Opening book integration:** 132K+ ECO positions (A-E + interpolated) with O(1) FEN lookup
- **Move classification:** Best (CPL ≤15), Good (≤40), Inaccuracy (≤80), Mistake (≤200), Blunder (>200)
- **Advanced detection:** Brilliant moves (sacrifice + tactical + gap≥150), Great moves (gap≥120), Forced moves (only legal move)
- **Tactical motifs:** Automatic detection of checks, captures, forks, checkmates per move
- **Blunder swing detection:** Identifies evaluation swings ≥250 centipawns as turning points
- **Performance metrics:** Accuracy %, ACPL, estimated rating using Stockfish-like decay formulas
- **Chess.com integration:** Import games with archive selection and time control filtering
- **Canvas-drawn arrows:** Color-coded best move visualization (green/blue/purple for top 3 lines)
- **Full game commentary:** Opening/middlegame/endgame summaries with key moments and narrative

### ⚔️ Multiplayer
- **1v1 Private Battles:** Real-time puzzle races with 6-digit room codes
- **Firebase Firestore:** Seamless room synchronization with `onSnapshot` listeners
- **5-minute matches:** 20 puzzles, highest score wins
- **Live score tracking:** Real-time opponent progress display
- **Room state machine:** Waiting → Countdown → In Progress → Finished
- **Cross-device support:** Battle from desktop vs mobile

### 🎨 User Experience
- **Modern dark theme:** Deep `#121212` background with vibrant `#ff8c00` accents
- **Chess.com piece theme** for professional, familiar appearance
- **Centralized audio system:** AudioManager class with mobile optimization (move, capture, castle, check, solved, wrong)
- **Animated homepage:** Count-up statistics with infinity symbol morphing
- **Instant feedback:** Move validation with turquoise (correct) and red (incorrect) glows
- **Mobile-responsive:** Touch-optimized chessboard with drag-and-drop

---

## Technical Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (Vanilla JS)                    │
│  index.html · puzzle.html · game-review.html · pvp.html    │
│  PuzzleScript.js · game-review.js · pvp.js · audio-manager │
└──────────────────────┬──────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┬──────────────┐
        ▼              ▼              ▼              ▼
┌──────────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐
│   getHint    │ │ analyze  │ │ chesscom │ │   Firebase   │
│     API      │ │ Position │ │   API    │ │  Firestore   │
│  (1515 loc)  │ │  (1003)  │ │  (83)    │ │ (Real-time)  │
└──────┬───────┘ └────┬─────┘ └──────────┘ └──────────────┘
       │              │
       ▼              ▼
┌──────────────┐ ┌─────────────────────────────────┐
│ GPT-4.1-mini │ │ HuggingFace Stockfish Batch API │
│ Tool Calling │ │  • 4 engines parallel           │
│ Multi-step   │ │  • Depth 18, MultiPV 3          │
│ Reasoning    │ │  • Batch size: 12 positions     │
└──────────────┘ └─────────────────────────────────┘
                 
┌─────────────────────────────────────────────────────────┐
│          Opening Book Database (132,730 positions)      │
│  ecoA.json (22,362) · ecoB.json (22,576)               │
│  ecoC.json (26,513) · ecoD.json (18,936)               │
│  ecoE.json (14,338) · eco_interpolated.json (28,005)   │
└─────────────────────────────────────────────────────────┘
```

---

## Engineering Highlights

### 1. Batch-Mode Game Analysis Engine

**Problem:** Sequential single-position Stockfish API calls cause slow full-game analysis (50+ moves = 50+ API calls).

**Solution:** Unified batch-mode architecture with persistent caching.

```javascript
// Backend performs 100% of engine work
const BATCH_SIZE = 12;
const PERSISTENT_CACHE = global.EVAL_CACHE || (global.EVAL_CACHE = new Map());

async function fetchBatch(fens, depth, multipv) {
  const uncachedFens = fens.filter(fen => !PERSISTENT_CACHE.has(getCacheKey(fen, depth, multipv)));
  
  // Parallel processing with 4 engines
  const response = await fetch(HF_BATCH_URL, {
    body: JSON.stringify({ fens: uncachedFens, depth, multipv })
  });
  
  // Cache results globally
  results.forEach((result, idx) => {
    PERSISTENT_CACHE.set(getCacheKey(fens[idx], depth, multipv), result);
  });
}
```

**Impact:**
- 50-move game: 50 sequential calls → 5 batch calls (10x speedup)
- Persistent cache survives serverless cold starts
- Zero redundant API calls for duplicate positions

### 2. POV-Aware Evaluation System

**Problem:** Stockfish returns evaluations from White's perspective, but analysis must display side-to-move perspective without double conversion.

**Solution:** Explicit perspective tracking with proper mate sorting.

```javascript
// Normalize centipawn scores to White's perspective
const cpWhite = turn === 'w' ? rawCp : -rawCp;
const mateWhite = turn === 'w' ? rawMate : -rawMate;

// Sort PVs correctly for side to move
pvs.sort((a, b) => {
  if (a.mate !== null && b.mate !== null) {
    return turn === 'w' ? a.mate - b.mate : b.mate - a.mate;
  }
  const aScore = turn === 'w' ? a.cp : -a.cp;
  const bScore = turn === 'w' ? b.cp : -b.cp;
  return bScore - aScore;
});
```

**Critical Fix:** Resolved reversed mate lines for Black (M3, M2, M1 → M1, M2, M3).

### 3. Agentic AI Coach with Tactical Detection

**Problem:** GPT-4 hallucinates chess moves, squares, and tactics when generating hints.

**Solution:** Multi-step reasoning with tool calling + safe verification layer.

```javascript
// Step 1: GPT decides which Stockfish analyses to request
const response = await callGPTWithTools(conversationHistory, OPENAI_API_KEY);

// Step 2: Execute tool calls, build position facts
const positionFacts = computeFullPositionFacts(fen, solutionMoves);
// Detects: forks, pins, skewers, hanging pieces, overloaded pieces

// Step 3: Safe explanation generation with allowed squares/pieces only
const allowedSquares = buildLegalSquares(positionFacts, stockfishAnalysis);
const safeExplanation = await safeGPT(structuredData, allowedSquares);

// Step 4: Verify no hallucinations
if (!verifyExplanation(safeExplanation, positionFacts, allowedSquares)) {
  return fallbackExplanation;
}
```

**Tactical Pattern Detection:**
- **Forks:** Piece attacks 2+ enemy pieces simultaneously
- **Pins:** Piece cannot move without exposing higher-value piece
- **Skewers:** Attacking high-value piece with lower-value piece behind
- **Hanging pieces:** Undefended pieces under attack
- **Overloaded pieces:** Defender protecting multiple critical squares

### 4. Opening Book Integration

**Problem:** Need fast opening identification for 132K+ positions without linear search.

**Solution:** O(1) FEN lookup with Map-based indexing.

```javascript
// Merged ECO A-E + interpolated databases
const OPENING_MAP = new Map();
for (const [eco, name, fen, moves] of openingsData) {
  OPENING_MAP.set(normalizeFen(fen), { eco, name, moves });
}

export function getOpening(fen) {
  return OPENING_MAP.get(normalizeFen(fen)) || null;
}
```

**Database Size:**
- ECO A: 22,362 positions
- ECO B: 22,576 positions
- ECO C: 26,513 positions
- ECO D: 18,936 positions
- ECO E: 14,338 positions
- Interpolated: 28,005 positions
- **Total: 132,730 positions**

### 5. Real-Time Multiplayer Synchronization

**Problem:** Two players need synchronized puzzle state, scores, and timer across devices.

**Solution:** Firebase Firestore with room document and `onSnapshot` listeners.

```javascript
// Room state machine
const roomStates = {
  waiting: 'waiting',
  countdown: 'countdown',
  inProgress: 'in_progress',
  finished: 'finished'
};

// Real-time listener
roomListener = onSnapshot(doc(db, 'pvp_rooms', roomCode), (snapshot) => {
  const roomData = snapshot.data();
  updateScores(roomData.hostScore, roomData.guestScore);
  updateTimer(roomData.timeRemaining);
  handleStateTransition(roomData.state);
});
```

**Features:**
- 6-digit room codes for private matches
- Automatic cleanup when host leaves
- Cross-device synchronization (desktop vs mobile)

### 6. Move Classification System

**Algorithm:** CPL-based thresholds with special detection for brilliant/great moves.

```javascript
function classifyMove(playedUci, beforeEval, afterEval, side, fen) {
  // Check if only legal move
  if (chess.moves().length === 1) return ['Forced', 'move-forced'];
  
  // Brilliant move detection
  const isSacrifice = move.captured && evalDrop <= 30;
  const isTactical = forcingMoveCount > 2;
  const isOnlyGoodMove = gap12 >= 100;
  if (isSacrifice && isTactical && isOnlyGoodMove) {
    return ['Brilliant', 'move-brilliant'];
  }
  
  // Standard CPL classification
  if (cpLoss <= 15) return ['Best', 'move-best'];
  if (cpLoss <= 40) return ['Good', 'move-good'];
  if (cpLoss <= 80) return ['Inaccuracy', 'move-inaccuracy'];
  if (cpLoss <= 200) return ['Mistake', 'move-mistake'];
  return ['Blunder', 'move-blunder'];
}
```

**Accuracy Formula (Stockfish-like decay):**
```javascript
function accuracyFromAcpl(acpl) {
  if (acpl < 10) return 99;
  if (acpl < 20) return 97;
  // ... decay curve
  return Math.max(10, 100 - Math.floor(acpl / 10));
}
```

---

## Technologies

### Core Stack
- **Frontend:** Vanilla JavaScript (ES6+), HTML5, CSS3
- **Chess Logic:** chess.js for move validation and position analysis
- **Chessboard UI:** chessboardjs with Chess.com piece theme
- **Backend:** Serverless functions (Vercel)

### APIs & Services
- **AI:** OpenAI GPT-4.1-mini with tool calling and structured outputs
- **Engine:** HuggingFace Stockfish batch API (4 engines, depth 18, multiPV 3)
- **Database:** Firebase Firestore for real-time multiplayer
- **External:** Lichess API for daily puzzles, Chess.com API for game imports

### Data & Storage
- **Puzzles:** 50,000+ pre-evaluated positions in JSON (puzzles.json)
- **Opening Book:** 132,730 ECO positions (A-E + interpolated) with O(1) lookup
- **Caching:** Persistent global Map for evaluation caching across requests

### Deployment
- **Hosting:** Vercel with serverless functions
- **CDN:** Firebase Hosting for static assets
- **Analytics:** Firebase Analytics

---

## File Structure

```
PawnPush/
├── api/                          # Custom serverless API layer
│   ├── getHint.js                # Agentic AI coach (1515 lines)
│   │                             # - GPT-4.1-mini with tool calling
│   │                             # - Tactical pattern detection
│   │                             # - Safe response verification
│   ├── analyzePosition.js        # Game analysis API (1003 lines)
│   │                             # - Batch-mode Stockfish processing
│   │                             # - Persistent global caching
│   │                             # - Opening book integration
│   │                             # - Move classification & metrics
│   ├── chesscom.js               # Chess.com game import (83 lines)
│   ├── stockfish.js              # Single-position Stockfish (108 lines)
│   └── firebase.js               # Firebase configuration (21 lines)
│
├── data/                         # Opening book database (132,730 positions)
│   ├── openings.js               # Merged ECO lookup with O(1) access
│   ├── ecoA.json                 # ECO A (22,362 positions)
│   ├── ecoB.json                 # ECO B (22,576 positions)
│   ├── ecoC.json                 # ECO C (26,513 positions)
│   ├── ecoD.json                 # ECO D (18,936 positions)
│   ├── ecoE.json                 # ECO E (14,338 positions)
│   └── eco_interpolated.json     # Interpolated (28,005 positions)
│
├── index.html                    # Landing page
├── puzzle.html                   # Puzzle interface
├── dailyPuzzle.html              # Daily puzzle page
├── game-review.html              # Game analysis interface
├── pvp.html                      # 1v1 battle interface
├── survival.html                 # Survival mode page
│
├── IndexScript.js                # Landing page logic with animated stats
├── PuzzleScript.js               # Puzzle game logic (494 lines)
├── dailyPuzzle.js                # Daily puzzle logic
├── game-review.js                # Game analysis frontend (937 lines)
├── pvp.js                        # Multiplayer logic (749 lines)
├── survival.js                   # Survival mode with global leaderboard
├── audio-manager.js              # Centralized audio system
│
├── style.css                     # Dark theme with orange accents
├── audio/                        # Sound effects (move, capture, castle, check, solved, wrong)
├── puzzles.json                  # 50,000+ pre-evaluated puzzles
├── package.json                  # Dependencies (chess.js, firebase)
└── vercel.json                   # Serverless deployment config
```

---

## Setup

### Prerequisites
- Node.js 12+
- OpenAI API key ([platform.openai.com](https://platform.openai.com))
- HuggingFace token ([huggingface.co](https://huggingface.co))

### Installation

```bash
# Clone repository
git clone <your-repo-url>
cd PawnPush

# Install dependencies
npm install

# Configure environment
cat > .env << EOF
OPENAI_API_KEY=your-openai-api-key
HF_TOKEN=your-huggingface-token
EOF

# Run development server
npm run dev
```

Visit `http://localhost:3000` to start solving puzzles.

---

## Skills Demonstrated

### Software Engineering
- Full-stack application architecture from frontend to serverless APIs
- Batch-mode processing with parallel engine workers and persistent caching
- Real-time multiplayer synchronization with state machines
- RESTful API design with proper error handling and timeouts

### AI/ML Integration
- Agentic AI systems with multi-step reasoning and tool calling
- GPT-4.1-mini structured outputs with JSON schemas
- Verification systems to prevent hallucinations
- Position analysis with tactical pattern detection

### Algorithms & Data Structures
- O(1) opening book lookup with Map-based indexing (132K+ positions)
- Batch processing algorithms for efficient API utilization
- Pseudo-legal move generation for attack/defense maps
- POV-aware evaluation with correct mate line sorting

### Performance Optimization
- Persistent global caching across serverless requests
- Batch API calls reducing latency by 10x
- Efficient FEN normalization and position deduplication
- Canvas rendering for responsive move visualization

### Systems Design
- Unified batch-mode architecture separating frontend/backend concerns
- State machines for multiplayer room lifecycle management
- Graceful degradation with fallback explanations
- Mobile-responsive design with touch optimization

---

## Future Roadmap

### Phase 1: Enhanced Analytics
- Move-by-move accuracy graphs
- Tactical pattern frequency analysis
- Opening repertoire tracking
- Performance trends over time

### Phase 2: Multiplayer Expansion
- Ranked matchmaking with ELO system
- Tournament brackets with Swiss pairings
- Global leaderboard with seasonal rankings
- Spectator mode for live matches

### Phase 3: Advanced AI
- Fine-tuned models for chess-specific coaching
- Personalized lesson plans based on user mistakes
- Spaced repetition for puzzle training
- Position similarity search with embeddings

### Phase 4: Platform Growth
- Mobile apps (React Native)
- Browser extension for Chess.com/Lichess
- API access for third-party integrations
- White-label solution for chess clubs

---

## Contributing

Contributions welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

**Areas for contribution:**
- 🐛 Bug fixes and optimizations
- 🎨 UI/UX improvements
- 🧩 New puzzle categories
- 📱 Mobile app development
- 🌐 Internationalization

---

## Live Demo

**[https://pawn-push.vercel.app](https://pawn-push.vercel.app)**

Play instantly without registration. Try the 1v1 Battle mode with a friend!

---

*Built to help chess players worldwide improve through AI-powered analysis and engaging puzzles.*
