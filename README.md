markdown
# PawnPush

PawnPush is an interactive chess puzzle platform designed to help players improve their skills through a vast collection of puzzles. Accessible online at [https://pawn-push.vercel.app](https://pawn-push.vercel.app), it offers categorized puzzles, AI-powered hints, and a coaching chat for personalized guidance.

## ✨ Features

### 🎯 **Core Puzzle Experience**
- **Multiple difficulty levels**: Beginner, Intermediate, Advanced, Grand Master
- **Various position types**: Opening, Middlegame, Endgame, Checkmate
- **Daily puzzles** with fresh content from Lichess API
- **Over 50,000 puzzles** stored in a comprehensive database
- **Interactive chessboard** with smooth drag-and-drop functionality

### 🤖 **AI-Powered Learning**
- **Smart hint system** powered by GPT-4 API
- **AI coaching chat** for tailored hints and explanations
- **Progressive hints** (visual cues, move suggestions, full solutions)
- **Move validation** with instant feedback

### 🎨 **Enhanced User Experience**
- **Chess.com piece theme** for professional, familiar appearance
- **Smooth animations** for puzzle transitions
- **Instant move feedback** for responsive gameplay
- **Mobile-responsive design** that works on all devices
- **Direct puzzle access** - no account required

### 🎮 **Game Modes**
- **Regular puzzles** with difficulty filtering
- **Daily puzzle** with fresh content
- **Game review** with position analysis
- **Hint system** with multiple levels of assistance

## 🛠️ Technologies Used

- **Frontend:** HTML5, CSS3, Vanilla JavaScript
- **Chessboard UI:** [Chessboard.js](https://chessboardjs.com/) with custom piece themes
- **Chess Logic:** [chess.js](https://github.com/jhlywa/chess.js) for move validation
- **AI Integration:** GPT-4 via serverless API for intelligent hints
- **External APIs:** Lichess API for daily puzzles
- **Piece Graphics:** Chess.com piece theme for professional appearance
- **Styling:** Custom CSS with modern design principles

## 📁 File Structure

```
PawnPush/
│
├── api/
│   └── getHint.js            # Serverless API for AI hints
│
├── stockfish/                 # Chess engine integration
│   └── README.md
│
├── index.html                 # Main landing page
├── puzzle.html                # Regular puzzle interface
├── dailyPuzzle.html           # Daily puzzle page
├── game-review.html           # Game analysis page
│
├── IndexScript.js             # Main site logic & daily puzzle loading
├── PuzzleScript.js            # Regular puzzle logic
├── dailyPuzzle.js             # Daily puzzle functionality
├── game-review.js             # Game analysis features
│
├── style.css                  # Modern CSS styling
├── puzzles.json               # 50,000+ puzzle database
├── puzzle_summary.json        # Puzzle metadata
├── package.json               # NPM dependencies
└── README.md                  # This file
```



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

## 🚀 Quick Start

### **Play Online**
Visit [https://pawn-push.vercel.app](https://pawn-push.vercel.app) to start solving puzzles immediately - no account required!

### **How to Play**
1. **Choose your mode**: Regular puzzles or Daily puzzle
2. **Select difficulty**: Beginner to Grand Master
3. **Pick position type**: Opening, Middlegame, Endgame, or Checkmate
4. **Make moves**: Drag and drop pieces on the interactive board
5. **Get hints**: Use the hint system or AI coaching chat
6. **Solve puzzles**: Complete puzzles to improve your chess skills

### **Features to Try**
- 🎯 **Daily Puzzle**: Fresh puzzle every day from Lichess
- 🤖 **AI Coach**: Ask questions about positions and moves
- 💡 **Smart Hints**: Progressive hints from visual cues to full solutions
- 📱 **Mobile Friendly**: Works perfectly on phones and tablets

## 🔧 How It Works

### **Puzzle System**
- **Database**: 50,000+ puzzles stored locally for instant access
- **Daily Updates**: Fresh puzzles from Lichess API
- **Smart Filtering**: Puzzles categorized by difficulty and position type
- **Move Validation**: Real-time validation using chess.js

### **AI Integration**
- **GPT-4 API**: Powers the intelligent hint system and coaching chat
- **Contextual Hints**: AI analyzes the current position and provides relevant guidance
- **Progressive Assistance**: Multiple hint levels from visual cues to full solutions

### **User Experience**
- **Chess.com Pieces**: Professional, familiar piece graphics
- **Smooth Animations**: Beautiful transitions between puzzles
- **Responsive Design**: Optimized for desktop, tablet, and mobile
- **No Registration**: Start playing immediately without creating an account

## 🤝 Contributing

Contributions are welcome! Here's how you can help:

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'Add amazing feature'`)
4. **Push** to the branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

### **Ideas for Contributions**
- 🐛 Bug fixes and improvements
- 🎨 UI/UX enhancements
- 🧩 New puzzle categories
- 📱 Mobile app features
- 🌐 Translations

## 🌐 Live Website

**[https://pawn-push.vercel.app](https://pawn-push.vercel.app)**

---

*Made to help chess players worldwide*
