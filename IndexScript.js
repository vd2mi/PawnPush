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