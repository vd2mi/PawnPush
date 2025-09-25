# Stockfish API Integration

This directory previously contained local Stockfish WASM files, but we now use the **Stockfish 17 API** from chess-api.com.

## What we're using now:
- **Real Stockfish 17** running on 32-core servers
- **No WASM issues** - all analysis happens remotely
- **Powerful analysis** - up to depth 18, 80 MNPS
- **Fast responses** - 50ms max thinking time

## API Details:
- **Endpoint**: https://chess-api.com/v1
- **Method**: POST requests with FEN positions
- **Response**: Real Stockfish analysis with evaluation scores

No local files needed - everything runs through the API!
