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
  }
})

document.querySelectorAll("#position-section button").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll("#position-section button").forEach(b => b.classList.remove("selected"))
    btn.classList.add("selected")
    window.selectedPosition = btn.id.replace('pos-','')
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

const pvpBtn = document.getElementById('pvpBtn');
if (pvpBtn){
  pvpBtn.addEventListener('click', () => {
    window.location.href = 'pvp.html';
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
    
    const ratingEl = document.getElementById('daily-puzzle-rating');
    const miniRatingEl = document.getElementById('mini-daily-rating');
    
    if (ratingEl && data.puzzle.rating) {
      const targetRating = String(data.puzzle.rating);
      const originalText = ratingEl.textContent;
      ratingEl.textContent = '0';
      
      setTimeout(() => {
        if (ratingEl && targetRating) {
          animateNumber(ratingEl, targetRating, '');
        }
      }, 1000);
    }
    
    if (miniRatingEl && data.puzzle.rating) {
      const targetRating = String(data.puzzle.rating);
      const originalText = miniRatingEl.textContent;
      miniRatingEl.textContent = '0';
      
      setTimeout(() => {
        if (miniRatingEl && targetRating) {
          animateNumber(miniRatingEl, targetRating, '');
        }
      }, 1000);
    }
    
    const themes = data.puzzle.themes.slice(0, 3).map(theme => 
      theme.charAt(0).toUpperCase() + theme.slice(1)
    ).join(' • ');
    const themesEl = document.getElementById('mini-daily-themes');
    if (themesEl) {
      themesEl.textContent = themes;
    }
  } else {
    const ratingEl = document.getElementById('daily-puzzle-rating');
    const miniRatingEl = document.getElementById('mini-daily-rating');
    const themesEl = document.getElementById('mini-daily-themes');
    
    if (ratingEl) ratingEl.textContent = 'Error';
    if (miniRatingEl) miniRatingEl.textContent = 'Error';
    if (themesEl) themesEl.textContent = 'Failed to load';
  }
}

function addCompletionGlow(element) {
  element.style.transition = 'text-shadow 0.5s ease-out, color 0.3s ease-out';
  element.style.textShadow = '0 0 15px rgba(255, 140, 0, 0.9), 0 0 25px rgba(255, 140, 0, 0.5)';
  element.style.color = '#ff8c00';
  
  setTimeout(() => {
    element.style.textShadow = '';
    element.style.color = '';
  }, 1000);
}

function animateNumber(element, targetValue, suffix = '') {
  const targetNum = parseFloat(targetValue.replace(/,/g, ''));
  const startNum = 0;
  
  const duration = Math.min(1500 + (targetNum / 100), 2500);
  const startTime = performance.now();
  let hasCompleted = false;
  
  function formatNumber(num) {
    const clamped = Math.min(Math.floor(num), targetNum);
    if (targetNum >= 1000) {
      return clamped.toLocaleString('en-US');
    }
    return clamped.toString();
  }
  
  function easeOutQuart(t) {
    return 1 - Math.pow(1 - t, 4);
  }
  
  function animate(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    
    const eased = easeOutQuart(progress);
    const currentValue = startNum + (targetNum - startNum) * eased;
    
    const formatted = formatNumber(currentValue);
    element.textContent = formatted + suffix;
    
    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      element.textContent = formatNumber(targetNum) + suffix;
      
      if (!hasCompleted) {
        hasCompleted = true;
        addCompletionGlow(element);
      }
    }
  }
  
  requestAnimationFrame(animate);
}

function animateStatsOnLoad() {
  const statNumbers = document.querySelectorAll('.stat-number');
  const statItems = document.querySelectorAll('.stat-item');
  const header = document.querySelector('header');
  
  if (header) {
    header.style.background = 'linear-gradient(135deg, #050505, #0a0a0a)';
    header.style.boxShadow = '0 4px 15px rgba(0, 0, 0, 0.5)';
    
    const h1 = header.querySelector('h1');
    if (h1) {
      h1.style.color = '#ff8c00';
    }
  }
  
  statItems.forEach((item, index) => {
    item.style.padding = '0.25rem 0.5rem';
    item.style.boxSizing = 'border-box';
    item.style.display = 'flex';
    item.style.flexDirection = 'column';
    item.style.alignItems = 'center';
    item.style.gap = '0.25rem';
    item.style.overflow = 'visible';
    
    item.style.opacity = '0';
    item.style.transform = 'translateY(20px)';
    item.style.transition = 'opacity 0.6s ease-out, transform 0.6s ease-out';
    
    setTimeout(() => {
      item.style.opacity = '1';
      item.style.transform = 'translateY(0)';
    }, index * 100);
  });
  
  statNumbers.forEach((statEl, index) => {
    statEl.style.margin = '0.1rem';
    
    const originalText = statEl.textContent.trim();
    
    if (originalText === '∞') {
      statEl.textContent = '0';
      setTimeout(() => {
        animateToInfinity(statEl, index);
      }, 400 + (index * 150));
      return;
    }
    
    if (originalText === '📅') {
      return;
    }
    
    const match = originalText.match(/^([\d,]+)(.*)$/);
    if (match) {
      const numberPart = match[1].replace(/,/g, '');
      const suffix = match[2] || '';
      
      statEl.textContent = '0' + suffix;
      
      setTimeout(() => {
        animateNumber(statEl, numberPart, suffix);
      }, 400 + (index * 150));
    }
  });
  
  addStatsSeparator();
}

function addStatsSeparator() {
  const statsBar = document.querySelector('.stats-bar');
  const header = document.querySelector('header');
  const mainSection = document.querySelector('main');
  
  if (statsBar && mainSection && !document.getElementById('stats-separator')) {
    const separator = document.createElement('div');
    separator.id = 'stats-separator';
    separator.style.width = '60%';
    separator.style.maxWidth = '600px';
    separator.style.height = '1px';
    separator.style.background = 'linear-gradient(to right, transparent, #3a4a5c, transparent)';
    separator.style.margin = '1rem auto';
    separator.style.marginBottom = '0.5rem';
    separator.style.opacity = '0.6';
    
    if (mainSection && mainSection.parentNode) {
      mainSection.parentNode.insertBefore(separator, mainSection);
    }
    
    separator.style.transition = 'opacity 0.5s ease-out';
    setTimeout(() => {
      separator.style.opacity = '1';
    }, 800);
  }
}

function animateToInfinity(element, index) {
  const startNum = 1000;
  const targetNum = 999999;
  const duration = 900;
  const startTime = performance.now();
  let hasCompleted = false;
  
  const parent = element.closest('.stat-item');
  if (parent) {
    parent.style.position = 'relative';
    parent.style.minHeight = '3rem';
    parent.style.minWidth = '4rem';
    
    element.style.fontSize = '2.5em';
    element.style.fontWeight = 'bold';
    element.style.position = 'relative';
    element.style.transformOrigin = 'center center';
  }
  
  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }
  
  function animate(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    
    const eased = easeOutCubic(progress);
    const currentValue = Math.floor(startNum + (targetNum - startNum) * eased);
    
    if (progress < 0.8) {
      element.textContent = currentValue.toLocaleString('en-US');
      requestAnimationFrame(animate);
    } else if (progress < 1) {
      const morphProgress = (progress - 0.8) / 0.2;
      const scale = 1 + (morphProgress * 0.1);
      const opacity = 1 - (morphProgress * 0.3);
      
      element.style.transition = 'transform 0.05s ease-out, opacity 0.05s ease-out';
      element.style.transform = `scale(${scale})`;
      element.style.opacity = String(opacity);
      element.textContent = currentValue.toLocaleString('en-US');
      requestAnimationFrame(animate);
    } else {
      element.style.transform = 'scale(1.05)';
      element.style.opacity = '1';
      element.style.transition = 'transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.5s ease-out';
      element.textContent = '∞';
      
      setTimeout(() => {
        element.style.transform = 'scale(1)';
      }, 150);
      
      if (!hasCompleted) {
        hasCompleted = true;
        addCompletionGlow(element);
      }
    }
  }
  
  requestAnimationFrame(animate);
}

document.addEventListener('DOMContentLoaded', () => {
  loadDailyPuzzle();
  animateStatsOnLoad();
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