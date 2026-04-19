import React, { useState, useEffect, useRef } from 'react';
import Cube from 'cubejs';
import confetti from 'canvas-confetti';
import { RotateCcw, Play, Pause, ChevronRight, ChevronLeft, CheckCircle2, AlertCircle, Loader2, Camera, Dices, Music, Volume2 } from 'lucide-react';
import clsx from 'clsx';
import { motion, AnimatePresence } from 'motion/react';
import SolverWorker from './solver.worker?worker';
import CameraScanner from './components/CameraScanner';
import GalaxyBackground from './components/GalaxyBackground';
import SplashScreen from './components/SplashScreen';

const FACES = ['U', 'R', 'F', 'D', 'L', 'B'];
const CENTERS = [4, 13, 22, 31, 40, 49];

const AUDIO_TRACKS = [
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-17.mp3',
];

const COLOR_MAP: Record<string, string> = {
  U: 'bg-white',
  R: 'bg-red-500',
  F: 'bg-green-500',
  D: 'bg-yellow-400',
  L: 'bg-orange-500',
  B: 'bg-blue-600',
  empty: 'bg-slate-700',
};

const COLOR_NAMES: Record<string, string> = {
  U: 'White',
  R: 'Red',
  F: 'Green',
  D: 'Yellow',
  L: 'Orange',
  B: 'Blue',
};

function getHexColor(color: string): string {
  switch (color) {
    case 'U': return '#ffffff';
    case 'R': return '#ef4444'; // red-500
    case 'F': return '#22c55e'; // green-500
    case 'D': return '#facc15'; // yellow-400
    case 'L': return '#f97316'; // orange-500
    case 'B': return '#2563eb'; // blue-600
    case 'empty': return '#94a3b8'; // slate-400
    default: return '#94a3b8';
  }
}

let audioCtx: AudioContext | null = null;

function playTurnSound() {
  try {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      audioCtx = new AudioContextClass();
    }
    
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    const ctx = audioCtx;
    
    // Plastic clack sound
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(200, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(30, ctx.currentTime + 0.1);

    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(0.5, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    // Add a tiny bit of noise for the sliding plastic sound
    const bufferSize = ctx.sampleRate * 0.1;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.value = 1000;
    
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.15, ctx.currentTime);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
    
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.1);
    noise.start();
    noise.stop(ctx.currentTime + 0.1);
  } catch (e) {
    console.error("Audio play failed", e);
  }
}

export default function App() {
  const [cubeState, setCubeState] = useState<string[]>(() => {
    const state = Array(54).fill('empty');
    state[4] = 'U';
    state[13] = 'R';
    state[22] = 'F';
    state[31] = 'D';
    state[40] = 'L';
    state[49] = 'B';
    return state;
  });

  const [selectedColor, setSelectedColor] = useState<string>('U');
  const [solution, setSolution] = useState<string[] | null>(null);
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [isSolving, setIsSolving] = useState<boolean>(false);
  const [isAutoPlaying, setIsAutoPlaying] = useState<boolean>(false);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [isMusicPlaying, setIsMusicPlaying] = useState<boolean>(false);
  const [showSplash, setShowSplash] = useState<boolean>(true);
  const [lastMoveTime, setLastMoveTime] = useState<number>(0);
  const workerRef = useRef<Worker | null>(null);
  const bgMusicRef = useRef<HTMLAudioElement | null>(null);
  const prevStepRef = useRef<number>(currentStep);

  useEffect(() => {
    workerRef.current = new SolverWorker();
    
    // Initialize random track
    if (bgMusicRef.current) {
      bgMusicRef.current.src = AUDIO_TRACKS[Math.floor(Math.random() * AUDIO_TRACKS.length)];
      bgMusicRef.current.volume = 0.4;
    }
    
    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  const handleSongEnd = () => {
    if (bgMusicRef.current) {
      const currentSrc = bgMusicRef.current.src;
      // Get a random song that is not the current one
      let nextSongs = AUDIO_TRACKS.filter(s => !currentSrc.includes(s.split('?')[0]));
      if (nextSongs.length === 0) nextSongs = AUDIO_TRACKS;
      bgMusicRef.current.src = nextSongs[Math.floor(Math.random() * nextSongs.length)];
      bgMusicRef.current.play().catch(console.error);
    }
  };

  const toggleMusic = () => {
    if (bgMusicRef.current) {
      if (isMusicPlaying) {
        bgMusicRef.current.pause();
      } else {
        bgMusicRef.current.play().catch(console.error);
      }
      setIsMusicPlaying(!isMusicPlaying);
    }
  };

  useEffect(() => {
    if (solution && currentStep !== prevStepRef.current) {
      playTurnSound();
      setLastMoveTime(Date.now());
      prevStepRef.current = currentStep;
    }
  }, [currentStep, solution]);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isAutoPlaying && solution && currentStep < solution.length) {
      timer = setTimeout(() => {
        setCurrentStep(s => s + 1);
      }, 2800);
    } else if (isAutoPlaying && solution && currentStep >= solution.length) {
      setIsAutoPlaying(false);
    }
    
    // Confetti on solve completion
    if (solution && currentStep === solution.length && solution.length > 0) {
      confetti({
        particleCount: 150,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#ffffff', '#ef4444', '#22c55e', '#facc15', '#f97316', '#2563eb']
      });
    }

    return () => clearTimeout(timer);
  }, [isAutoPlaying, currentStep, solution]);

  const handleSquareClick = (index: number) => {
    if (CENTERS.includes(index)) return;
    
    setCubeState((prev) => {
      const newState = [...prev];
      newState[index] = selectedColor;
      return newState;
    });
    setError(null);
    setSolution(null);
    setIsAutoPlaying(false);
  };

  const validateCube = () => {
    const counts: Record<string, number> = { U: 0, R: 0, F: 0, D: 0, L: 0, B: 0, empty: 0 };
    cubeState.forEach((c) => counts[c]++);

    if (counts.empty > 0) {
      setError(`Please fill all squares. ${counts.empty} remaining.`);
      return false;
    }

    for (const color of ['U', 'R', 'F', 'D', 'L', 'B']) {
      if (counts[color] !== 9) {
        setError(`Invalid cube: Each color must appear exactly 9 times. ${COLOR_NAMES[color]} appears ${counts[color]} times.`);
        return false;
      }
    }

    setIsSolving(true);
    setError(null);

    const worker = workerRef.current;
    if (!worker) {
      setError('Solver is initializing. Please try again in a moment.');
      setIsSolving(false);
      return;
    }
    
    // Safety timeout in case the solver hangs on an invalid cube
    const timeout = setTimeout(() => {
      // If it times out, we need to terminate and recreate the worker
      worker.terminate();
      workerRef.current = new SolverWorker();
      setIsSolving(false);
      setError('Solver timed out. The cube configuration is likely invalid or unsolvable.');
    }, 10000);

    worker.onmessage = (e) => {
      clearTimeout(timeout);
      setIsSolving(false);
      const { success, solveStr, isSolved, error } = e.data;
      
      if (success) {
        if (isSolved) {
          setSolution([]);
          setIsAutoPlaying(false);
          confetti({
            particleCount: 100,
            spread: 70,
            origin: { y: 0.6 },
            colors: ['#ffffff', '#ef4444', '#22c55e', '#facc15', '#f97316', '#2563eb']
          });
        } else {
          const moves = solveStr.split(' ').filter(Boolean);
          setSolution(moves);
          setCurrentStep(0);
          setIsAutoPlaying(true);
        }
      } else {
        setError(error || 'Invalid cube configuration. Please check your colors.');
      }
    };

    worker.postMessage({ cubeStr: cubeState.join('') });
  };

  const handleSolve = () => {
    validateCube();
  };

  const handleScramble = () => {
    // @ts-ignore - The types for cubejs are sometimes missing methods, but randomize exists
    const c = new Cube();
    c.randomize();
    setCubeState(c.asString().split(''));
    setSolution(null);
    setCurrentStep(0);
    setError(null);
    setIsAutoPlaying(false);
  };

  const handleReset = () => {
    setCubeState(() => {
      const state = Array(54).fill('empty');
      state[4] = 'U';
      state[13] = 'R';
      state[22] = 'F';
      state[31] = 'D';
      state[40] = 'L';
      state[49] = 'B';
      return state;
    });
    setSolution(null);
    setCurrentStep(0);
    setError(null);
    setIsAutoPlaying(false);
  };

  return (
    <>
      <AnimatePresence>
        {showSplash && <SplashScreen onComplete={() => setShowSplash(false)} />}
      </AnimatePresence>

      <div className="min-h-screen transition-colors duration-500 flex flex-col items-center py-8 px-4 font-sans text-slate-100">
        
        <GalaxyBackground />

      {/* Hidden audio element for background music */}
      <audio ref={bgMusicRef} onEnded={handleSongEnd} className="hidden" preload="auto" />
      
      <div className="max-w-5xl w-full bg-transparent rounded-3xl shadow-[0_0_50px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col border border-white/10 transition-colors duration-500">
        
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-center p-4 sm:p-6 md:p-8 border-b border-white/10 bg-transparent transition-colors duration-500 gap-4 sm:gap-0">
          <h1 className="text-2xl sm:text-3xl font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-indigo-400 text-center sm:text-left drop-shadow-sm">
            Isaacski Rubik Solver
          </h1>
          <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3 w-full sm:w-auto">
            <button
              onClick={() => setIsScanning(true)}
              className="flex items-center px-3 sm:px-4 py-2 text-sm font-bold bg-indigo-900/60 text-indigo-300 hover:bg-indigo-800/80 rounded-xl transition-colors shadow-sm border border-indigo-500/30 backdrop-blur-sm"
              title="Scan Cube with Camera"
            >
              <Camera size={18} className="mr-1 sm:mr-2" />
              <span className="hidden leading-none xs:inline md:inline">Scan Cube</span>
              <span className="inline leading-none xs:hidden">Scan</span>
            </button>
            <button
              onClick={handleScramble}
              className="flex items-center px-3 sm:px-4 py-2 text-sm font-bold bg-purple-900/60 text-purple-300 hover:bg-purple-800/80 rounded-xl transition-colors shadow-sm border border-purple-500/30 backdrop-blur-sm"
              title="Scramble Cube randomly"
            >
              <Dices size={18} className="mr-1 sm:mr-2 hidden lg:block" />
              Scramble
            </button>
            <button
              onClick={toggleMusic}
              className={clsx(
                "p-2 justify-center flex items-center rounded-xl transition-colors border backdrop-blur-sm",
                isMusicPlaying 
                  ? "bg-blue-900/60 text-blue-400 border-blue-500/30"
                  : "bg-slate-800/60 text-slate-300 hover:bg-slate-700/80 border-slate-600/30 animate-pulse"
              )}
              title={isMusicPlaying ? "Pause Background Music" : "Play Background Music"}
            >
              {isMusicPlaying ? <Volume2 size={20} /> : <Music size={20} />}
            </button>
            <button
              onClick={handleReset}
              className="flex items-center px-3 sm:px-4 py-2 text-sm font-medium text-slate-300 bg-slate-800/60 hover:text-red-400 hover:bg-red-900/50 rounded-xl transition-colors border border-slate-600/30 backdrop-blur-sm"
              title="Reset Cube"
            >
              <RotateCcw size={16} className="mr-1 sm:mr-2 hidden sm:block" />
              Reset
            </button>
          </div>
        </div>

        <div className="flex flex-col md:flex-row flex-1 relative">
          
          <AnimatePresence>
            {isScanning && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="absolute inset-0 z-50 bg-black/90 backdrop-blur-md rounded-b-3xl overflow-hidden"
              >
                <CameraScanner 
                  initialState={cubeState}
                  onCancel={() => setIsScanning(false)}
                  onScanComplete={(newState) => {
                    setCubeState(newState);
                    setIsScanning(false);
                  }}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Left Panel: Cube Input */}
          {!solution && (
            <div className="flex-1 p-4 sm:p-6 md:p-8 border-b md:border-b-0 md:border-r border-white/10 bg-transparent transition-colors duration-500">
              {/* 3D Cube */}
              <Cube3D 
                cubeState={cubeState} 
                solution={null}
                currentStep={0}
                handleSquareClick={handleSquareClick}
                lastMoveTime={lastMoveTime}
              />

              <>
                {/* Color Palette */}
                <div className="mb-6 mt-4">
                  <h3 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wider text-center">Select Color</h3>
                  <div className="flex flex-wrap gap-2 sm:gap-3 justify-center">
                    {['U', 'L', 'F', 'R', 'B', 'D', 'empty'].map((c) => (
                      <motion.button
                        key={c}
                        onClick={() => setSelectedColor(c)}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        className={clsx(
                          'w-10 h-10 sm:w-12 sm:h-12 rounded-full border-2 shadow-sm flex items-center justify-center relative overflow-hidden shrink-0',
                          COLOR_MAP[c],
                          selectedColor === c ? 'ring-4 ring-blue-500 ring-offset-2 ring-offset-slate-900 scale-110 border-transparent' : 'border-white/20'
                        )}
                        title={c === 'empty' ? 'Eraser' : COLOR_NAMES[c]}
                      >
                        {c === 'empty' && <div className="absolute inset-0 flex items-center justify-center text-slate-300 bg-white/10"><RotateCcw size={16} /></div>}
                      </motion.button>
                    ))}
                  </div>
                </div>

                {error && (
                  <div className="mb-6 p-4 bg-red-900/40 border-l-4 border-red-500 text-red-100 flex items-start rounded-r-md backdrop-blur-sm">
                    <AlertCircle className="w-5 h-5 mr-2 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-left">{error}</p>
                  </div>
                )}

                <button
                  onClick={handleSolve}
                  disabled={isSolving}
                  className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl shadow-md cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center text-lg"
                >
                  {isSolving ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      Solving...
                    </>
                  ) : (
                    <>
                      <Play className="w-5 h-5 mr-2" />
                      Solve Cube
                    </>
                  )}
                </button>
              </>
            </div>
          )}

          {/* Right Panel: Solution Guide */}
          <div className={clsx("p-4 sm:p-6 md:p-8 flex flex-col transition-colors duration-500", (solution) ? "flex-1 items-center bg-transparent" : "w-full md:w-96 bg-transparent")}>
            {!solution ? (
              <>
                <h2 className="text-xl font-bold text-slate-100 mb-2 drop-shadow-sm">Solution Guide</h2>
                <p className="text-sm text-slate-300 mb-6 drop-shadow-sm">
                  Note: This uses the advanced Kociemba algorithm to solve the cube in 20 moves or less.
                  Make sure the <strong className="text-white drop-shadow-[0_0_5px_rgba(255,255,255,0.5)]">White</strong> center is facing UP and the <strong className="text-green-300 drop-shadow-[0_0_5px_rgba(34,197,94,0.5)]">Green</strong> center is facing FRONT before you start.
                </p>
                <div className="flex-1 flex flex-col items-center justify-center text-slate-400 text-center">
                  <div className="w-24 h-24 mb-4 opacity-20">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                      <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                      <line x1="12" y1="22.08" x2="12" y2="12"></line>
                    </svg>
                  </div>
                  <p>Fill in your cube colors and click Solve to get step-by-step instructions.</p>
                </div>
              </>
            ) : solution.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-green-400 text-center drop-shadow-sm">
                <CheckCircle2 className="w-16 h-16 mb-4" />
                <h3 className="text-xl font-bold mb-2">Cube is already solved!</h3>
                <p className="text-slate-600 dark:text-slate-400">Great job!</p>
              </div>
            ) : (
              <div className="flex-1 flex flex-col w-full max-w-2xl">
                <div className="text-center mb-6">
                  <h2 className="text-2xl font-bold text-slate-100 mb-2 drop-shadow-sm">Interactive Solution Guide</h2>
                  <p className="text-slate-300 drop-shadow-sm">Follow the 3D cube to solve your physical cube.</p>
                </div>

                {/* 3D Cube as the Guide */}
                <div className="bg-transparent p-4 sm:p-6 rounded-2xl shadow-sm border border-white/10 mb-8 transition-colors duration-500">
                  <Cube3D 
                    cubeState={cubeState} 
                    solution={solution}
                    currentStep={currentStep}
                    handleSquareClick={handleSquareClick}
                    lastMoveTime={lastMoveTime}
                  />
                  
                  {currentStep < solution.length ? (
                    <div className="text-center mt-4">
                      <span className="inline-block px-4 py-1 bg-blue-900/60 text-blue-300 rounded-full text-sm font-bold mb-3 uppercase tracking-wider backdrop-blur-sm shadow-sm">
                        Step {currentStep + 1} of {solution.length}
                      </span>
                      <div className="text-3xl font-black text-white mb-1 tracking-tighter drop-shadow-md">
                        {solution[currentStep]}
                      </div>
                      <p className="text-slate-300 font-medium drop-shadow-sm">
                        {getMoveDescription(solution[currentStep])}
                      </p>
                    </div>
                  ) : (
                    <div className="text-center mt-4 text-green-400 drop-shadow-sm">
                      <CheckCircle2 className="w-12 h-12 mx-auto mb-2" />
                      <h3 className="text-xl font-bold">Cube Solved!</h3>
                    </div>
                  )}
                </div>

                <div className="flex justify-between items-center gap-2 sm:gap-4 max-w-md mx-auto w-full">
                  <button
                    onClick={() => setCurrentStep(s => Math.max(0, s - 1))}
                    disabled={currentStep === 0 || isAutoPlaying}
                    className="flex-1 py-3 sm:py-4 px-2 sm:px-4 bg-slate-800/40 border border-slate-500/30 text-slate-200 font-bold rounded-xl hover:bg-slate-700/60 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex justify-center items-center text-sm md:text-base"
                  >
                    <ChevronLeft className="w-5 h-5 sm:w-6 sm:h-6 mr-1" />
                    Back
                  </button>
                  <button
                    onClick={() => setIsAutoPlaying(!isAutoPlaying)}
                    disabled={currentStep === solution.length}
                    className="py-3 sm:py-4 px-6 sm:px-8 bg-blue-900/60 text-blue-300 font-bold rounded-xl hover:bg-blue-800/80 border border-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex justify-center items-center shadow-sm"
                    title={isAutoPlaying ? "Pause Auto-Play" : "Start Auto-Play"}
                  >
                    {isAutoPlaying ? <Pause className="w-6 h-6 sm:w-8 sm:h-8" /> : <Play className="w-6 h-6 sm:w-8 sm:h-8" />}
                  </button>
                  <button
                    onClick={() => setCurrentStep(s => Math.min(solution.length, s + 1))}
                    disabled={currentStep === solution.length || isAutoPlaying}
                    className="flex-1 py-3 sm:py-4 px-2 sm:px-4 bg-blue-600/90 text-white font-bold rounded-xl hover:bg-blue-500/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex justify-center items-center shadow-md hover:shadow-lg text-sm md:text-base"
                  >
                    Next
                    <ChevronRight className="w-5 h-5 sm:w-6 sm:h-6 ml-1" />
                  </button>
                </div>
                
                {/* Progress Bar */}
                <div className="mt-8 w-full max-w-md mx-auto bg-slate-800/50 rounded-full h-3 overflow-hidden border border-white/5">
                  <div 
                    className="bg-blue-500 h-full rounded-full transition-all duration-500 ease-out shadow-[0_0_10px_rgba(59,130,246,0.8)]" 
                    style={{ width: `${(currentStep / solution.length) * 100}%` }}
                  ></div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
    </>
  );
}

function getMoveDescription(move: string): string {
  const face = move[0];
  const modifier = move[1] || '';
  
  const faceNames: Record<string, string> = {
    U: 'Up (White)',
    D: 'Down (Yellow)',
    R: 'Right (Red)',
    L: 'Left (Orange)',
    F: 'Front (Green)',
    B: 'Back (Blue)'
  };

  const direction = modifier === "'" ? 'counter-clockwise' : modifier === '2' ? '180 degrees (twice)' : 'clockwise';
  
  return `Turn the ${faceNames[face]} face ${direction}.`;
}

function getFaceletIndex(face: string, x: number, y: number, z: number): number {
  if (face === 'U' && y === -1) return 0 + (z + 1) * 3 + (x + 1);
  if (face === 'R' && x === 1) return 9 + (y + 1) * 3 + (1 - z);
  if (face === 'F' && z === 1) return 18 + (y + 1) * 3 + (x + 1);
  if (face === 'D' && y === 1) return 27 + (1 - z) * 3 + (x + 1);
  if (face === 'L' && x === -1) return 36 + (y + 1) * 3 + (z + 1);
  if (face === 'B' && z === -1) return 45 + (y + 1) * 3 + (1 - x);
  return -1;
}

function getMoveTransform(move: string) {
  const face = move[0];
  const modifier = move[1] || '';
  let axis = 'Y', sign = 1, filter = (c: any) => false;
  
  switch(face) {
    case 'U': axis = 'Y'; sign = -1; filter = (c: any) => c.y === -1; break;
    case 'D': axis = 'Y'; sign = 1; filter = (c: any) => c.y === 1; break;
    case 'R': axis = 'X'; sign = 1; filter = (c: any) => c.x === 1; break;
    case 'L': axis = 'X'; sign = -1; filter = (c: any) => c.x === -1; break;
    case 'F': axis = 'Z'; sign = 1; filter = (c: any) => c.z === 1; break;
    case 'B': axis = 'Z'; sign = -1; filter = (c: any) => c.z === -1; break;
  }
  
  let angle = 90;
  let turns = 1;
  if (modifier === "'") {
    angle = -90;
    turns = -1;
  } else if (modifier === '2') {
    angle = 180;
    turns = 2;
  }
  
  return { axis, angle: sign * angle, filter, turns: sign * turns };
}

function rotateCoords(x: number, y: number, z: number, axis: string, turns: number) {
  let nx = x, ny = y, nz = z;
  turns = ((turns % 4) + 4) % 4;
  
  for (let i = 0; i < turns; i++) {
    if (axis === 'X') {
      const ty = ny;
      ny = -nz;
      nz = ty;
    } else if (axis === 'Y') {
      const tx = nx;
      nx = nz;
      nz = -tx;
    } else if (axis === 'Z') {
      const tx = nx;
      nx = -ny;
      ny = tx;
    }
  }
  return { x: nx, y: ny, z: nz };
}

const CUBIE_SIZE = 56;
const SPACING = 2;
const OFFSET = CUBIE_SIZE + SPACING;

function initializeCubies(cubeState: string[]) {
  const data = [];
  for (let x of [-1, 0, 1]) {
    for (let y of [-1, 0, 1]) {
      for (let z of [-1, 0, 1]) {
        const colors: Record<string, string> = {};
        if (y === -1) colors.U = cubeState[getFaceletIndex('U', x, y, z)];
        if (y === 1) colors.D = cubeState[getFaceletIndex('D', x, y, z)];
        if (x === 1) colors.R = cubeState[getFaceletIndex('R', x, y, z)];
        if (x === -1) colors.L = cubeState[getFaceletIndex('L', x, y, z)];
        if (z === 1) colors.F = cubeState[getFaceletIndex('F', x, y, z)];
        if (z === -1) colors.B = cubeState[getFaceletIndex('B', x, y, z)];
        
        data.push({
          id: `${x},${y},${z}`,
          x, y, z,
          transform: `translate3d(${x * OFFSET}px, ${y * OFFSET}px, ${z * OFFSET}px)`,
          colors
        });
      }
    }
  }
  return data;
}

function getCubiesState(cubeState: string[], solution: string[] | null, currentStep: number) {
  let cubies = initializeCubies(cubeState);
  
  if (!solution || solution.length === 0) return cubies;
  
  const moveTransforms = solution.map(move => getMoveTransform(move));
  
  cubies = cubies.map(cubie => {
    let currentX = cubie.x;
    let currentY = cubie.y;
    let currentZ = cubie.z;
    
    const angles = moveTransforms.map((transform, index) => {
      let angle = 0;
      if (transform.filter({ x: currentX, y: currentY, z: currentZ })) {
        if (index < currentStep) {
          angle = transform.angle;
        }
        const newCoords = rotateCoords(currentX, currentY, currentZ, transform.axis, transform.turns);
        currentX = newCoords.x;
        currentY = newCoords.y;
        currentZ = newCoords.z;
      }
      return { axis: transform.axis, angle };
    });
    
    let transformStr = '';
    for (let i = angles.length - 1; i >= 0; i--) {
      transformStr += `rotate${angles[i].axis}(${angles[i].angle}deg) `;
    }
    transformStr += cubie.transform;
    
    return {
      ...cubie,
      transform: transformStr
    };
  });
  
  return cubies;
}

interface Cube3DProps {
  cubeState: string[];
  solution: string[] | null;
  currentStep: number;
  handleSquareClick: (index: number) => void;
  lastMoveTime?: number;
}

function Cube3D({ cubeState, solution, currentStep, handleSquareClick, lastMoveTime }: Cube3DProps) {
  const [rotation, setRotation] = useState({ x: -30, y: -45 });
  const dragInfo = React.useRef({ startX: 0, startY: 0, currentX: -30, currentY: -45, isDragging: false, dragDistance: 0 });

  const [impact, setImpact] = useState({ x: 0, y: 0 });
  const cubeWrapperRef = useRef<HTMLDivElement>(null);
  const auraRef = useRef<HTMLDivElement>(null);
  const rotationRef = useRef(rotation);
  const impactRef = useRef(impact);

  useEffect(() => {
    rotationRef.current = rotation;
  }, [rotation]);

  useEffect(() => {
    impactRef.current = impact;
  }, [impact]);

  useEffect(() => {
    let frameId: number;
    const startTime = Date.now();
    
    const animate = () => {
      const time = (Date.now() - startTime) / 1000;
      let sX = 0;
      let sY = 0;

      if (!dragInfo.current.isDragging) {
        sX = Math.sin(time * 0.5) * 2;
        sY = Math.cos(time * 0.7) * 2;
      }
      
      if (cubeWrapperRef.current) {
        cubeWrapperRef.current.style.transform = `rotateX(${rotationRef.current.x + impactRef.current.x + sX}deg) rotateY(${rotationRef.current.y + impactRef.current.y + sY}deg) translateZ(0)`;
      }
      if (auraRef.current) {
        auraRef.current.style.transform = `translate3d(-50%, -50%, 0) scale(${1 + Math.sin((rotationRef.current.x + rotationRef.current.y) * 0.05) * 0.2})`;
      }

      frameId = requestAnimationFrame(animate);
    };
    
    frameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameId);
  }, []);

  useEffect(() => {
    if (lastMoveTime) {
      // Subtle camera "kick" on move
      const intensity = 8;
      setImpact({ 
        x: (Math.random() - 0.5) * intensity, 
        y: (Math.random() - 0.5) * intensity 
      });
      const timer = setTimeout(() => setImpact({ x: 0, y: 0 }), 300);
      return () => clearTimeout(timer);
    }
  }, [lastMoveTime]);

  const handlePointerDown = (e: React.PointerEvent) => {
    // We don't use setPointerCapture here to allow child onClick events to fire correctly
    dragInfo.current.isDragging = true;
    dragInfo.current.startX = e.clientX;
    dragInfo.current.startY = e.clientY;
    dragInfo.current.currentX = rotation.x;
    dragInfo.current.currentY = rotation.y;
    dragInfo.current.dragDistance = 0;
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragInfo.current.isDragging) return;
    const deltaX = e.clientX - dragInfo.current.startX;
    const deltaY = e.clientY - dragInfo.current.startY;
    const dist = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    dragInfo.current.dragDistance = dist;
    
    // Only capture pointer if we've actually started dragging significantly
    if (dist > 5 && !e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.setPointerCapture(e.pointerId);
    }

    setRotation({
      x: dragInfo.current.currentX - deltaY * 0.5,
      y: dragInfo.current.currentY + deltaX * 0.5
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    dragInfo.current.isDragging = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const cubies = React.useMemo(() => getCubiesState(cubeState, solution, currentStep), [cubeState, solution, currentStep]);

  const snapToView = (x: number, y: number) => {
    setRotation({ x, y });
    dragInfo.current.currentX = x;
    dragInfo.current.currentY = y;
  };

  const rotateView = (dx: number, dy: number) => {
    setRotation(prev => {
      const newX = prev.x + dx;
      const newY = prev.y + dy;
      dragInfo.current.currentX = newX;
      dragInfo.current.currentY = newY;
      return { x: newX, y: newY };
    });
  };

  return (
    <div className="flex flex-col items-center w-full mb-8">
      <div className="flex flex-col items-center gap-4 w-full">
        <p className="text-sm font-medium text-blue-300 animate-pulse drop-shadow-md">Drag to rotate or use controls</p>
        
        {/* View Controls */}
        <div className="flex flex-wrap justify-center gap-2 mb-2">
          <div className="flex bg-black/40 rounded-lg shadow-sm border border-white/10 p-1">
            <button onClick={() => snapToView(0, 0)} className="px-2 py-1 text-xs text-white font-bold hover:bg-white/10 rounded transition-colors">Front</button>
            <button onClick={() => snapToView(-90, 0)} className="px-2 py-1 text-xs text-white font-bold hover:bg-white/10 rounded transition-colors">Top</button>
            <button onClick={() => snapToView(0, -90)} className="px-2 py-1 text-xs text-white font-bold hover:bg-white/10 rounded transition-colors">Right</button>
            <button onClick={() => snapToView(-30, -45)} className="px-2 py-1 text-xs text-white font-bold hover:bg-white/10 rounded transition-colors">ISO</button>
          </div>
          
          <div className="flex bg-black/40 rounded-lg shadow-sm border border-white/10 p-1 gap-1 text-white">
            <button onClick={() => rotateView(90, 0)} className="p-1 hover:bg-white/10 rounded transition-colors" title="Rotate View Up"><ChevronRight className="w-4 h-4 -rotate-90" /></button>
            <button onClick={() => rotateView(-90, 0)} className="p-1 hover:bg-white/10 rounded transition-colors" title="Rotate View Down"><ChevronRight className="w-4 h-4 rotate-90" /></button>
            <button onClick={() => rotateView(0, 90)} className="p-1 hover:bg-white/10 rounded transition-colors" title="Rotate View Left"><ChevronLeft className="w-4 h-4" /></button>
            <button onClick={() => rotateView(0, -90)} className="p-1 hover:bg-white/10 rounded transition-colors" title="Rotate View Right"><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
      </div>

      <div 
        className="relative w-full h-64 sm:h-80 md:h-96 flex items-center justify-center cursor-grab active:cursor-grabbing touch-none overflow-hidden"
        style={{ perspective: '1200px' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {/* Dynamic Aura background */}
        <div 
          ref={auraRef}
          className="absolute top-1/2 left-1/2 w-64 h-64 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none"
          style={{
            background: 'radial-gradient(circle, rgba(99,102,241,0.4) 0%, rgba(59,130,246,0.15) 40%, rgba(0,0,0,0) 70%)',
            willChange: 'transform'
          }}
        />
        
        <div 
          className="relative w-0 h-0"
          style={{ 
            transformStyle: 'preserve-3d', 
          }}
        >
          <div
            ref={cubeWrapperRef}
            className="relative w-0 h-0 scale-95 sm:scale-110 md:scale-125 lg:scale-150"
            style={{
               transformStyle: 'preserve-3d',
            }}
          >
            {cubies.map(cubie => (
              <div
                key={cubie.id}
                className="absolute top-1/2 left-1/2"
                style={{
                  width: CUBIE_SIZE,
                  height: CUBIE_SIZE,
                  marginLeft: -CUBIE_SIZE / 2,
                  marginTop: -CUBIE_SIZE / 2,
                  transform: cubie.transform,
                  transformStyle: 'preserve-3d',
                  transition: 'transform 1.8s cubic-bezier(0.4, 0, 0.2, 1)'
                }}
              >
                {['U', 'D', 'L', 'R', 'F', 'B'].map(face => {
                  if (!cubie.colors[face]) return null;
                  
                  let faceTransform = '';
                  switch(face) {
                    case 'U': faceTransform = `rotateX(90deg) translateZ(${CUBIE_SIZE/2}px)`; break;
                    case 'D': faceTransform = `rotateX(-90deg) translateZ(${CUBIE_SIZE/2}px)`; break;
                    case 'R': faceTransform = `rotateY(90deg) translateZ(${CUBIE_SIZE/2}px)`; break;
                    case 'L': faceTransform = `rotateY(-90deg) translateZ(${CUBIE_SIZE/2}px)`; break;
                    case 'F': faceTransform = `rotateY(0deg) translateZ(${CUBIE_SIZE/2}px)`; break;
                    case 'B': faceTransform = `rotateY(180deg) translateZ(${CUBIE_SIZE/2}px)`; break;
                  }
                  
                  const color = cubie.colors[face];
                  const isCenter = cubie.id.split(',').filter(v => v === '0').length === 2;
                  
                  const originalX = parseInt(cubie.id.split(',')[0]);
                  const originalY = parseInt(cubie.id.split(',')[1]);
                  const originalZ = parseInt(cubie.id.split(',')[2]);
                  const index = getFaceletIndex(face, originalX, originalY, originalZ);

                  return (
                    <div
                      key={face}
                      onClick={(e) => {
                        e.stopPropagation();
                        // Increase threshold slightly for better touch support
                        if (dragInfo.current.dragDistance < 15) {
                          handleSquareClick(index);
                        }
                      }}
                      className={clsx(
                        "absolute top-0 left-0 w-full h-full rounded-[4px] transition-opacity duration-200",
                        isCenter ? 'cursor-not-allowed' : 'cursor-pointer hover:opacity-90 active:scale-95'
                      )}
                      style={{ 
                        transform: faceTransform, 
                        backfaceVisibility: 'hidden',
                        backgroundColor: getHexColor(color),
                        // Premium stickerless plastic look: strong inner shade for rounded edge, specular highlight
                        backgroundImage: 'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0) 45%), linear-gradient(135deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0) 50%, rgba(0,0,0,0.15) 100%)',
                        boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.8), inset 0 0 4px 1px rgba(0,0,0,0.5), inset 0 2px 2px rgba(255,255,255,0.5), 0 0 1.5px rgba(0,0,0,0.9)'
                      }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
