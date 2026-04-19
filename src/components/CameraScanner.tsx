import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Camera, X, ChevronRight, Check, AlertCircle } from 'lucide-react';
import { clsx } from 'clsx';

interface CameraScannerProps {
  onScanComplete: (scannedState: string[]) => void;
  onCancel: () => void;
  initialState: string[];
}

const FACES = ['U', 'R', 'F', 'D', 'L', 'B'];
const FACE_NAMES: Record<string, string> = {
  U: 'Top (White Center)',
  R: 'Right (Red Center)',
  F: 'Front (Green Center)',
  D: 'Bottom (Yellow Center)',
  L: 'Left (Orange Center)',
  B: 'Back (Blue Center)'
};

// Based on standard RGB values used in the app, but optimized for camera capture
const CANONICAL_COLORS: Record<string, [number, number, number]> = {
  'U': [255, 255, 255], // White
  'R': [200, 30, 30],  // Red
  'F': [30, 160, 60],  // Green
  'D': [240, 220, 40], // Yellow
  'L': [240, 110, 20], // Orange
  'B': [30, 80, 200]   // Blue
};

function classifyColor(r: number, g: number, b: number): string {
  let minDistance = Infinity;
  let bestFace = 'empty';
  
  // Use HSL for better distinction in different lighting
  let r_norm = r / 255;
  let g_norm = g / 255;
  let b_norm = b / 255;
  let max = Math.max(r_norm, g_norm, b_norm), min = Math.min(r_norm, g_norm, b_norm);
  let h = 0, s = 0, l = (max + min) / 2;

  if (max !== min) {
    let d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r_norm: h = (g_norm - b_norm) / d + (g_norm < b_norm ? 6 : 0); break;
      case g_norm: h = (b_norm - r_norm) / d + 2; break;
      case b_norm: h = (r_norm - g_norm) / d + 4; break;
    }
    h /= 6;
  }
  h = Math.round(h * 360);
  s = Math.round(s * 100);
  l = Math.round(l * 100);

  // High lightness or very low saturation is usually White
  if (l > 75 || (s < 20 && l > 50)) return 'U';
  
  // Check against hue thresholds
  if (h >= 45 && h <= 80) return 'D'; // Yellow
  if (h >= 10 && h <= 44) return 'L'; // Orange
  if (h >= 340 || h <= 10) return 'R'; // Red
  if (h >= 80 && h <= 165) return 'F'; // Green
  if (h >= 165 && h <= 260) return 'B'; // Blue
  
  // Fallback to nearest neighbor if Hue is ambiguous
  for (const [face, [cr, cg, cb]] of Object.entries(CANONICAL_COLORS)) {
    // Weighted Euclidean distance
    const dist = Math.sqrt(
      (r - cr) * (r - cr) * 0.3 + 
      (g - cg) * (g - cg) * 0.59 + 
      (b - cb) * (b - cb) * 0.11
    );
    if (dist < minDistance) {
      minDistance = dist;
      bestFace = face;
    }
  }
  return bestFace;
}

const COLOR_BG: Record<string, string> = {
  U: 'bg-white',
  R: 'bg-red-600',
  F: 'bg-green-600',
  D: 'bg-yellow-400',
  L: 'bg-orange-500',
  B: 'bg-blue-600',
  empty: 'bg-slate-300'
};

export default function CameraScanner({ onScanComplete, onCancel, initialState }: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentFaceIndex, setCurrentFaceIndex] = useState(0);
  
  // Store the full cube state that we are building
  const [scannedState, setScannedState] = useState<string[]>([...initialState]);
  // Live preview of the 9 colors on the currently viewed face
  const [liveColors, setLiveColors] = useState<string[]>(Array(9).fill('empty'));
  const [stableProgress, setStableProgress] = useState(0);
  
  const [scanPhase, setScanPhase] = useState<'scanning' | 'review'>('scanning');
  const [isAutoCapture, setIsAutoCapture] = useState(false); // Defaulting to false for more manual control
  
  const autoCaptureRef = useRef({ lastColors: '', count: 0, faceIndex: 0 });
  const currentFace = FACES[currentFaceIndex];

  // Audio for capture
  const playCaptureSound = () => {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.05);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } catch(e) {}
  };

  // Initialize camera
  useEffect(() => {
    async function initCamera() {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('Your browser does not support accessing the camera, or you are not in a secure context (HTTPS).');
        }

        let mediaStream: MediaStream;
        try {
          // Attempt to get the rear/environment camera first
          mediaStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 720 }, height: { ideal: 720 } }
          });
        } catch (err: any) {
          if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError' || err.message?.includes('Permission denied')) {
            throw err; // Do not fallback if it's explicitly a permission error
          }
          console.warn("Could not get environment camera, falling back to default.", err);
          // Fallback to any available camera (often fixes issues on laptops/desktops without 'environment' cameras)
          mediaStream = await navigator.mediaDevices.getUserMedia({
            video: true
          });
        }
        
        setStream(mediaStream);
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
      } catch (err: any) {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError' || err.message?.includes('Permission denied')) {
          setError('Permission Denied: Your browser blocked access to the camera.');
          console.warn('Camera permission denied by user or browser.');
        } else {
          setError(`Camera access error: ${err.message || 'Denied or unavailable'}.`);
          console.error('Camera initialization error:', err);
        }
      }
    }
    
    initCamera();
    
    return () => {
      setStream(prevStream => {
        if (prevStream) {
          prevStream.getTracks().forEach(track => track.stop());
        }
        return null;
      });
    };
  }, []);

  // Set up the sampling loop
  useEffect(() => {
    let animationFrameId: number;
    let lastSampleTime = 0;

    const sampleColors = (timestamp: number) => {
      if (scanPhase === 'review') {
        // Just loop and wait, don't overwrite user's manual edits
        animationFrameId = requestAnimationFrame(sampleColors);
        return;
      }

      if (timestamp - lastSampleTime > 150) { // Sample every 150ms
        if (videoRef.current && canvasRef.current && stream && !error) {
          const video = videoRef.current;
          const canvas = canvasRef.current;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          
          if (ctx && video.videoWidth > 0 && video.videoHeight > 0) {
            // Match canvas size to video size
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            
            // Draw current frame
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            
            // Calculate grid bounds (assume a square grid in the center of the video)
            const minDim = Math.min(canvas.width, canvas.height);
            const gridWidth = minDim * 0.85; // Grid takes up 85% of the smallest dimension
            const startX = (canvas.width - gridWidth) / 2;
            const startY = (canvas.height - gridWidth) / 2;
            const cellSize = gridWidth / 3;
            
            const newColors = [];
            
            for (let i = 0; i < 9; i++) {
              if (i === 4) {
                // Center is always fixed for standard cubes based on face
                newColors.push(currentFace);
                continue;
              }
              
              const row = Math.floor(i / 3);
              const col = i % 3;
              
              // Sample from the center of each cell
              const sampleX = startX + (col * cellSize) + (cellSize / 2);
              const sampleY = startY + (row * cellSize) + (cellSize / 2);
              
              // Average a small 10x10 area to reduce noise
              const areaSize = 10;
              let rTotal = 0, gTotal = 0, bTotal = 0;
              const imgData = ctx.getImageData(sampleX - areaSize/2, sampleY - areaSize/2, areaSize, areaSize).data;
              
              for (let j = 0; j < imgData.length; j += 4) {
                rTotal += imgData[j];
                gTotal += imgData[j+1];
                bTotal += imgData[j+2];
              }
              
              const pixelCount = imgData.length / 4;
              const r = Math.round(rTotal / pixelCount);
              const g = Math.round(gTotal / pixelCount);
              const b = Math.round(bTotal / pixelCount);
              
              newColors.push(classifyColor(r, g, b));
            }
            
            setLiveColors(newColors);
            
            // Auto Capture logic
            if (isAutoCapture) {
              const colorsString = newColors.join(',');
              if (!newColors.includes('empty')) {
                // Same colors, same face
                if (colorsString === autoCaptureRef.current.lastColors && autoCaptureRef.current.faceIndex === currentFaceIndex) {
                  autoCaptureRef.current.count += 1;
                  // Update progress smoothly (target is 10 frames = ~1.5s)
                  setStableProgress(Math.min(100, (autoCaptureRef.current.count / 8) * 100));
                  
                  if (autoCaptureRef.current.count >= 8) {
                    // Capture triggered!
                    playCaptureSound();
                    autoCaptureRef.current.count = 0;
                    setStableProgress(0);
                    
                    if (videoRef.current) videoRef.current.pause();
                    setScanPhase('review');
                  }
                } else {
                  autoCaptureRef.current.lastColors = colorsString;
                  autoCaptureRef.current.count = 0;
                  autoCaptureRef.current.faceIndex = currentFaceIndex;
                  setStableProgress(0);
                }
              } else {
                autoCaptureRef.current.count = 0;
                setStableProgress(0);
              }
            } else {
              autoCaptureRef.current.count = 0;
              setStableProgress(0);
            }

            lastSampleTime = timestamp;
          }
        }
      }
      animationFrameId = requestAnimationFrame(sampleColors);
    };

    animationFrameId = requestAnimationFrame(sampleColors);
    
    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [stream, error, currentFace, scanPhase, isAutoCapture]);

  const handleCapture = () => {
    playCaptureSound();
    if (videoRef.current) videoRef.current.pause();
    setScanPhase('review');
  };

  const handleRetake = () => {
    if (videoRef.current) videoRef.current.play();
    setScanPhase('scanning');
    setLiveColors(Array(9).fill('empty')); // Clear it out so it re-reads
    autoCaptureRef.current.count = 0;
    setStableProgress(0);
  };

  const handleConfirm = () => {
    const newState = [...scannedState];
    const startIndex = currentFaceIndex * 9;
    
    // Apply live colors (even if manually tweaked) to the scanned state
    for (let i = 0; i < 9; i++) {
      newState[startIndex + i] = liveColors[i];
    }
    
    setScannedState(newState);
    
    if (currentFaceIndex < 5) {
      setCurrentFaceIndex(prev => {
        autoCaptureRef.current.faceIndex = prev + 1;
        return prev + 1;
      });
      if (videoRef.current) videoRef.current.play();
      setScanPhase('scanning');
      setLiveColors(Array(9).fill('empty'));
      autoCaptureRef.current.count = 0;
      setStableProgress(0);
    } else {
      // Done scanning all 6 faces
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      onScanComplete(newState);
    }
  };

  const handleManualColorCycle = (index: number) => {
    if (index === 4) return; // Center is fixed
    if (scanPhase !== 'review') return; // Only allow editing during the review pause
    
    setLiveColors(prev => {
      const current = prev[index];
      const order = ['U', 'R', 'F', 'D', 'L', 'B'];
      const nextIndex = (order.indexOf(current) + 1) % order.length;
      const newColors = [...prev];
      newColors[index] = order[nextIndex];
      return newColors;
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-end overflow-hidden">
      {/* Header */}
      <div className="w-full p-6 pb-20 flex justify-between items-start text-white bg-gradient-to-b from-black via-black/60 to-transparent absolute top-0 z-20">
        <div>
          <h2 className="text-xl font-black tracking-tight mb-0.5">Scan Face {currentFaceIndex + 1}</h2>
          <p className="text-blue-400 font-bold text-sm tracking-wide uppercase">{FACE_NAMES[currentFace]}</p>
        </div>
        <button 
          onClick={() => {
            if (stream) stream.getTracks().forEach(track => track.stop());
            onCancel();
          }}
          className="p-3 bg-white/5 hover:bg-white/10 rounded-full transition-all border border-white/10 backdrop-blur-md active:scale-90"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      {/* Main Camera Area */}
      <div className="relative w-full flex flex-col items-center px-4 mb-2">
        {error ? (
          <div className="p-6 bg-red-900/40 text-red-100 border border-red-500/30 rounded-2xl max-w-md text-center m-4 backdrop-blur-xl">
            <AlertCircle className="w-12 h-12 mx-auto mb-4 text-red-400" />
            <h3 className="text-xl font-bold text-white mb-2 font-mono uppercase tracking-tighter">Connection Lost</h3>
            <p className="font-medium text-sm mb-4 opacity-80">{error}</p>
            <div className="flex flex-col gap-3 mt-4">
              <button 
                onClick={onCancel}
                className="px-6 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg font-bold text-xs uppercase tracking-widest transition-colors border border-white/10"
              >
                Go Back
              </button>
            </div>
          </div>
        ) : (
          <div className="relative w-full max-w-[400px] aspect-square bg-slate-900 mx-auto rounded-[2.5rem] overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.5)] border-2 border-white/5 shrink-0">
            <video 
              ref={videoRef} 
              autoPlay 
              playsInline 
              muted 
              className="absolute inset-0 w-full h-full object-cover"
            />
            {/* Hidden canvas for image processing */}
            <canvas ref={canvasRef} className="hidden" />

            {/* Grid Overlay */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none p-6">
              <div className="w-full aspect-square grid grid-cols-3 grid-rows-3 gap-1 rounded-2xl bg-black/20 backdrop-blur-[1px] border border-white/10 overflow-hidden">
                {liveColors.map((color, i) => (
                  <div 
                    key={i} 
                    className={clsx(
                      "w-full h-full border-white/10 pointer-events-auto transition-all duration-300",
                      i === 4 ? "border-2 z-10" : "border-[0.5px] cursor-pointer hover:bg-white/5",
                      COLOR_BG[color],
                      scanPhase === 'scanning' ? "opacity-40" : "opacity-90"
                    )}
                    onClick={() => handleManualColorCycle(i)}
                  >
                      {i === 4 && (
                        <div className="w-full h-full flex items-center justify-center opacity-100 mix-blend-difference text-white">
                          <Check className="w-5 h-5 stroke-[3]" />
                        </div>
                      )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer Controls */}
      <div className="w-full p-6 pb-[env(safe-area-inset-bottom,24px)] flex flex-col items-center gap-6 bg-gradient-to-t from-black via-black/90 to-black/90">
        <div className="text-center w-full max-w-[320px]">
          <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-4 mb-2 shadow-xl">
             {currentFaceIndex === 0 && <p className="text-blue-400 font-black text-sm uppercase tracking-wider mb-1">Face: WHITE CENTER</p>}
             {currentFaceIndex === 0 && <p className="text-white/60 text-xs font-medium">Position cube with white center in the middle.</p>}
             
             {currentFaceIndex === 1 && <p className="text-red-400 font-black text-sm uppercase tracking-wider mb-1">Face: RED CENTER</p>}
             {currentFaceIndex === 1 && <p className="text-white/60 text-xs font-medium">Rotate cube RIGHT for the red face.</p>}
             
             {currentFaceIndex === 2 && <p className="text-green-400 font-black text-sm uppercase tracking-wider mb-1">Face: GREEN CENTER</p>}
             {currentFaceIndex === 2 && <p className="text-white/60 text-xs font-medium">Rotate cube LEFT for the green face.</p>}
             
             {currentFaceIndex === 3 && <p className="text-yellow-400 font-black text-sm uppercase tracking-wider mb-1">Face: YELLOW CENTER</p>}
             {currentFaceIndex === 3 && <p className="text-white/60 text-xs font-medium">Rotate cube DOWN for the yellow face.</p>}
             
             {currentFaceIndex === 4 && <p className="text-orange-400 font-black text-sm uppercase tracking-wider mb-1">Face: ORANGE CENTER</p>}
             {currentFaceIndex === 4 && <p className="text-white/60 text-xs font-medium">Rotate cube RIGHT twice for orange.</p>}
             
             {currentFaceIndex === 5 && <p className="text-blue-500 font-black text-sm uppercase tracking-wider mb-1">Face: BLUE CENTER</p>}
             {currentFaceIndex === 5 && <p className="text-white/60 text-xs font-medium">Rotate cube RIGHT for the final blue face.</p>}
          </div>
        </div>

        {scanPhase === 'review' ? (
          <div className="flex gap-3 w-full max-w-[360px]">
            <button
              onClick={handleRetake}
              className="flex-1 py-4 bg-slate-800 hover:bg-slate-700 text-white font-black text-xs uppercase tracking-widest rounded-2xl transition-all border border-white/10 active:scale-95 shadow-lg"
            >
              Retake
            </button>
            <button
              onClick={handleConfirm}
              className="flex-1 py-4 bg-blue-600 hover:bg-blue-500 text-white font-black text-xs uppercase tracking-widest rounded-2xl transition-all shadow-xl active:scale-95 flex items-center justify-center gap-2"
            >
              Confirm Face
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-6">
            <button
              disabled={!!error}
              onClick={handleCapture}
              className="group relative w-20 h-20 rounded-full bg-white flex items-center justify-center hover:scale-105 active:scale-90 transition-all disabled:opacity-30 shadow-[0_0_30px_rgba(255,255,255,0.2)]"
            >
              {/* Progress Ring for Auto Capture */}
              {isAutoCapture && (
                <svg className="absolute -inset-2 w-[calc(100%+16px)] h-[calc(100%+16px)] -rotate-90 pointer-events-none" viewBox="0 0 100 100">
                  <circle
                    cx="50"
                    cy="50"
                    r="46"
                    fill="none"
                    stroke="rgba(255,255,255,0.1)"
                    strokeWidth="4"
                  />
                  <circle
                    cx="50"
                    cy="50"
                    r="46"
                    fill="none"
                    stroke="#3b82f6"
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeDasharray="289"
                    strokeDashoffset={289 - (289 * stableProgress) / 100}
                    className="transition-all duration-150"
                  />
                </svg>
              )}
              <div className="absolute inset-1 rounded-full border-2 border-black/5" />
              <Camera className="w-8 h-8 text-black group-hover:scale-110 transition-transform" />
            </button>

            <button 
              onClick={() => setIsAutoCapture(!isAutoCapture)}
              className={clsx(
                "flex items-center gap-2 px-6 py-2 rounded-full border transition-all active:scale-95 shadow-lg",
                isAutoCapture ? "bg-blue-600/20 border-blue-500/50 text-blue-400" : "bg-white/5 border-white/10 text-white/40"
              )}
            >
              <div className={clsx("w-2 h-2 rounded-full animate-pulse", isAutoCapture ? "bg-blue-400" : "bg-white/20")} />
              <span className="text-[10px] font-black uppercase tracking-[0.2em]">Auto-Capture {isAutoCapture ? 'ON' : 'OFF'}</span>
            </button>
          </div>
        )}
        
        <div className="flex gap-2 mb-2">
          {FACES.map((f, i) => (
            <div 
              key={f}
              className={clsx(
                "h-1.5 transition-all duration-500 rounded-full",
                i < currentFaceIndex ? "bg-blue-500 w-4 shadow-[0_0_8px_rgba(59,130,246,0.6)]" : 
                i === currentFaceIndex ? "bg-white w-8 shadow-[0_0_12px_rgba(255,255,255,0.8)]" : 
                "bg-white/10 w-2"
              )}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
