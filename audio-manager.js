
class AudioManager {
  constructor() {
    this.sounds = {};
    this.audioContext = null;
    this.isInitialized = false;
    this.userInteracted = false;
    this.currentlyPlaying = new Set();
    this.mobileDevice = this.detectMobileDevice();
    
   
    this.init();
  }

  detectMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  }

  init() {
    const soundFiles = {
      move: 'audio/move.mp3',
      capture: 'audio/capture.mp3',
      castle: 'audio/castle.mp3',
      check: 'audio/move-check.mp3',
      wrong: 'audio/wrong.mp3',
      solved: 'audio/solved.mp3'
    };

    Object.keys(soundFiles).forEach(soundName => {
      this.sounds[soundName] = new Audio(soundFiles[soundName]);
      this.sounds[soundName].preload = 'auto';
      this.sounds[soundName].volume = 0.7;
      
      this.sounds[soundName].addEventListener('ended', () => {
        this.currentlyPlaying.delete(soundName);
      });
      
      this.sounds[soundName].addEventListener('error', (e) => {
        console.warn(`Audio error for ${soundName}:`, e);
        this.currentlyPlaying.delete(soundName);
      });
    });

    this.setupUserInteractionHandler();
    
    this.isInitialized = true;
  }

  setupUserInteractionHandler() {
    const interactionEvents = ['click', 'touchstart', 'touchend', 'keydown'];
    
    const handleUserInteraction = () => {
      if (!this.userInteracted) {
        this.userInteracted = true;
        
        interactionEvents.forEach(event => {
          document.removeEventListener(event, handleUserInteraction, true);
        });
      }
    };

    interactionEvents.forEach(event => {
      document.addEventListener(event, handleUserInteraction, true);
    });
  }

  async playSound(soundName, options = {}) {
    if (!this.isInitialized) {
      console.warn('AudioManager not initialized');
      return false;
    }

    if (!this.sounds[soundName]) {
      console.warn(`Sound '${soundName}' not found`);
      return false;
    }

    if (this.mobileDevice && !this.userInteracted) {
      return false;
    }

    if (options.preventOverlap !== false) {
      this.stopAllSounds();
      
      if (this.mobileDevice) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    try {
      const audio = this.sounds[soundName];
      
      audio.currentTime = 0;
      
      if (options.volume !== undefined) {
        audio.volume = Math.max(0, Math.min(1, options.volume));
      }

      this.currentlyPlaying.add(soundName);
      
      await audio.play();
      
      return true;
      
    } catch (error) {
      console.warn(`Failed to play sound '${soundName}':`, error);
      this.currentlyPlaying.delete(soundName);
      
      if (this.isMobileAudioError(error)) {
        this.handleMobileAudioError();
      }
      
      return false;
    }
  }

  isMobileAudioError(error) {
    return error.name === 'NotAllowedError' || 
           error.name === 'NotSupportedError' ||
           error.message.includes('user interaction') ||
           error.message.includes('autoplay');
  }

  handleMobileAudioError() {
    if (!this.userInteracted) {
    }
  }

  stopSound(soundName) {
    if (this.sounds[soundName]) {
      this.sounds[soundName].pause();
      this.sounds[soundName].currentTime = 0;
      this.currentlyPlaying.delete(soundName);
    }
  }

  stopAllSounds() {
    Object.keys(this.sounds).forEach(soundName => {
      this.stopSound(soundName);
    });
  }

  setVolume(volume) {
    const clampedVolume = Math.max(0, Math.min(1, volume));
    Object.values(this.sounds).forEach(audio => {
      audio.volume = clampedVolume;
    });
  }

  getVolume() {
    return this.sounds.move ? this.sounds.move.volume : 0.7;
  }

  isPlaying(soundName) {
    return this.currentlyPlaying.has(soundName);
  }

  getCurrentlyPlaying() {
    return Array.from(this.currentlyPlaying);
  }

  enableAudio() {
    this.userInteracted = true;
  }

  isAudioReady() {
    return this.userInteracted || !this.mobileDevice;
  }
}

window.audioManager = new AudioManager();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AudioManager;
}
