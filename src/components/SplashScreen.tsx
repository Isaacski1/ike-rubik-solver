import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2 } from 'lucide-react';

interface SplashScreenProps {
  onComplete: () => void;
}

export default function SplashScreen({ onComplete }: SplashScreenProps) {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    // Sequence the animations
    const t1 = setTimeout(() => setStage(1), 800); // Show text
    const t2 = setTimeout(() => setStage(2), 2500); // Start fade out
    const t3 = setTimeout(() => onComplete(), 3000); // Unmount

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [onComplete]);

  return (
    <AnimatePresence>
      <motion.div
        key="splash"
        initial={{ opacity: 1 }}
        exit={{ opacity: 0, scale: 1.1, filter: 'blur(10px)' }}
        transition={{ duration: 0.8, ease: "easeInOut" }}
        className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#050b14] overflow-hidden"
      >
        {/* Animated Background Gradients */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <motion.div
            animate={{
              scale: [1, 1.2, 1],
              opacity: [0.3, 0.5, 0.3],
              rotate: [0, 90, 0]
            }}
            transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
            className="absolute -top-[20%] -left-[10%] w-[70vw] h-[70vw] rounded-full bg-blue-600/20 blur-[100px]"
          />
          <motion.div
            animate={{
              scale: [1, 1.5, 1],
              opacity: [0.2, 0.4, 0.2],
              rotate: [0, -90, 0]
            }}
            transition={{ duration: 12, repeat: Infinity, ease: "linear" }}
            className="absolute top-[40%] -right-[20%] w-[60vw] h-[60vw] rounded-full bg-indigo-600/20 blur-[120px]"
          />
        </div>

        <div className="relative z-10 flex flex-col items-center">
          {/* Logo / Cube Animation */}
          <motion.div
            initial={{ scale: 0, rotateX: 180, rotateY: 180 }}
            animate={{ scale: 1, rotateX: 0, rotateY: 0 }}
            transition={{ type: "spring", damping: 15, stiffness: 100, duration: 1.5 }}
            className="relative w-32 h-32 mb-8 perspective-1000"
          >
            {/* Glowing aura */}
            <div className="absolute inset-0 bg-blue-500/30 blur-2xl rounded-full animate-pulse" />
            
            {/* Minimalist Grid representing a Rubik's Cube face */}
            <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 gap-1 p-2 bg-slate-900 rounded-2xl border-2 border-slate-700/50 shadow-[0_0_30px_rgba(59,130,246,0.5)]">
              {[...Array(9)].map((_, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, scale: 0 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.5 + (i * 0.1), type: "spring" }}
                  className={`rounded-sm ${
                    i === 4 ? 'bg-white' : 
                    i % 2 === 0 ? 'bg-blue-500' : 'bg-indigo-500'
                  }`}
                />
              ))}
            </div>
          </motion.div>

          {/* Title */}
          <div className="h-20 flex flex-col justify-center items-center">
            <AnimatePresence>
              {stage >= 1 && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                  className="flex flex-col items-center"
                >
                  <h1 className="text-4xl md:text-5xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-br from-white via-blue-100 to-indigo-300 drop-shadow-lg mb-2">
                    Isaacski
                  </h1>
                  <h2 className="text-xl md:text-2xl font-bold tracking-widest text-blue-400/80 uppercase">
                    Rubik Solver
                  </h2>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Loading Indicator */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: stage >= 1 ? 1 : 0 }}
            transition={{ delay: 1 }}
            className="absolute bottom-[-60px] flex items-center text-slate-500 text-sm font-medium tracking-widest uppercase"
          >
            <Loader2 className="w-4 h-4 mr-2 animate-spin text-blue-500" />
            Initializing
          </motion.div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
