const toggleButtonElement1 = document.getElementById('startSolvingBtn');
toggleButtonElement1.addEventListener('click',() => {
    const difficulty = window.selectedDifficulty || 'beginner';
    const position = window.selectedPosition || 'middlegame';
    window.location.href = `puzzle.html?difficulty=${difficulty}&position=${position}`;
});



document.querySelectorAll("#difficulty-section button").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll("#difficulty-section button").forEach(b => b.classList.remove("selected"))
    btn.classList.add("selected")
    window.selectedDifficulty = btn.id.replace('diff-','')
    console.log('Selected difficulty:', window.selectedDifficulty)
  }
})

document.querySelectorAll("#position-section button").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll("#position-section button").forEach(b => b.classList.remove("selected"))
    btn.classList.add("selected")
    window.selectedPosition = btn.id.replace('pos-','')
    console.log('Selected position:', window.selectedPosition)
  }
})
const toggleButtonElement2 = document.getElementById('gamereviewBtn');
toggleButtonElement2.addEventListener('click',() => {
    window.location.href = 'game-review.html';
  })

const survivalBtn = document.getElementById('survivalBtn');
if (survivalBtn){
  survivalBtn.addEventListener('click', () => {
    window.location.href = 'survival.html';
  })
}

let dailyPuzzleData = null;

async function fetchDailyPuzzle() {
  try {
    const response = await fetch('https://lichess.org/api/puzzle/daily');
    if (!response.ok) {
      throw new Error('Failed to fetch daily puzzle');
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching daily puzzle:', error);
    return null;
  }
}

async function loadDailyPuzzle() {
  const data = await fetchDailyPuzzle();
  if (data) {
    dailyPuzzleData = data;
    
    document.getElementById('daily-puzzle-rating').textContent = data.puzzle.rating;
    document.getElementById('mini-daily-rating').textContent = data.puzzle.rating;
    
    const themes = data.puzzle.themes.slice(0, 3).map(theme => 
      theme.charAt(0).toUpperCase() + theme.slice(1)
    ).join(' • ');
    document.getElementById('mini-daily-themes').textContent = themes;
  } else {
    document.getElementById('daily-puzzle-rating').textContent = 'Error';
    document.getElementById('mini-daily-rating').textContent = 'Error';
    document.getElementById('mini-daily-themes').textContent = 'Failed to load';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadDailyPuzzle();
});

const dailyPuzzleBtn = document.getElementById('dailyPuzzleBtn');
dailyPuzzleBtn.addEventListener('click', () => {
  if (dailyPuzzleData) {
    sessionStorage.setItem('dailyPuzzle', JSON.stringify(dailyPuzzleData));
    window.location.href = 'dailyPuzzle.html';
  } else {
    alert('Daily puzzle not loaded yet. Please try again.');
  }
});
const miniDailyPuzzleBtn = document.getElementById('mini-dailyPuzzleBtn');
if (miniDailyPuzzleBtn) {
  miniDailyPuzzleBtn.addEventListener('click', () => {
    if (dailyPuzzleData) {
      sessionStorage.setItem('dailyPuzzle', JSON.stringify(dailyPuzzleData));
      window.location.href = 'dailyPuzzle.html';
    } else {
      alert('Daily puzzle not loaded yet. Please try again.');
    }
  });
}