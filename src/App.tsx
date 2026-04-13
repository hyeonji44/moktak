/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Howl } from 'howler';
import { Heart, Flame, Info, RotateCcw, Trophy } from 'lucide-react';
import moktakSoundFile from '../sound.wav';

const STORAGE_USER_ID_KEY = 'moktak-user-id';

function getOrCreateUserId() {
  if (typeof window === 'undefined') {
    return `user_server`;
  }

  const savedUserId = window.localStorage.getItem(STORAGE_USER_ID_KEY);
  if (savedUserId) {
    return savedUserId;
  }

  const newUserId = `user_${Math.random().toString(36).slice(2, 11)}`;
  window.localStorage.setItem(STORAGE_USER_ID_KEY, newUserId);
  return newUserId;
}

function toSafeNumber(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readCountPayload(data: any) {
  return {
    count: toSafeNumber(data?.count ?? data?.currentCount),
    globalTotal: toSafeNumber(data?.globalTotal ?? data?.total),
    visitorCount: toSafeNumber(data?.visitorCount ?? data?.visitors),
  };
}

// 클릭할 때 나는 목탁 소리
const moktakSound = new Howl({
  src: [moktakSoundFile],
  volume: 1.0,
  html5: true,
  preload: true,
});

export default function App() {
  const [count, setCount] = useState(0);
  const [globalTotal, setGlobalTotal] = useState(0);
  const [visitorCount, setVisitorCount] = useState(0);
  const [isTapping, setIsTapping] = useState(false);
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([]);
  const [userId] = useState(getOrCreateUserId);
  
  // Custom Stick Cursor Style - Larger and clearer
  const stickCursor = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 64 64'><path d='M10 54 L54 10' stroke='%238b4513' stroke-width='8' stroke-linecap='round'/><circle cx='54' cy='10' r='6' fill='%238b4513'/></svg>") 54 10, auto`;

  // For batching updates to backend
  const pendingHits = useRef(0);
  const syncTimer = useRef<NodeJS.Timeout | null>(null);

  const fetchTotals = useCallback(() => {
    return fetch('/api/hits/total')
      .then(async res => {
        const data = await res.json();
        if (!res.ok) {
          throw new Error(`Failed to fetch total: ${res.status} ${JSON.stringify(data)}`);
        }
        const stats = readCountPayload(data);
        setGlobalTotal(stats.globalTotal);
        setVisitorCount(stats.visitorCount);
      });
  }, []);

  // Fetch initial count
  useEffect(() => {
    fetch(`/api/hits/${userId}`)
      .then(async res => {
        const data = await res.json();
        if (!res.ok) {
          throw new Error(`Failed to fetch hits: ${res.status} ${JSON.stringify(data)}`);
        }
        const stats = readCountPayload(data);
        setCount(stats.count);
        setGlobalTotal(stats.globalTotal);
        setVisitorCount(stats.visitorCount);
      })
      .catch(err => console.error("Failed to fetch hits:", err));

    fetchTotals().catch(err => console.error("Failed to fetch total:", err));

    // Poll for global total every 10 seconds
    const interval = setInterval(() => {
      fetchTotals().catch(err => console.error("Failed to fetch total:", err));
    }, 10000);

    return () => clearInterval(interval);
  }, [fetchTotals, userId]);

  const syncWithBackend = useCallback(() => {
    if (pendingHits.current === 0) return;

    const increment = pendingHits.current;
    pendingHits.current = 0;

    fetch(`/api/hits/${userId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ increment }),
    })
      .then(async res => {
        const data = await res.json();
        if (!res.ok) {
          throw new Error(`Failed to sync hits: ${res.status} ${JSON.stringify(data)}`);
        }
        const stats = readCountPayload(data);
        setCount(stats.count);
        setGlobalTotal(stats.globalTotal);
        setVisitorCount(stats.visitorCount);
      })
      .catch(err => {
        console.error("Sync failed, restoring pending hits:", err);
        pendingHits.current += increment;
    });
  }, [userId]);

  const handleTap = (e: React.PointerEvent<HTMLButtonElement>) => {
    // Start BGM on first interaction (Browser policy)
    if ('vibrate' in navigator) {
  navigator.vibrate(50); // 50ms 동안 짧게 진동
}



    // Play sound
    try {
      moktakSound.play();
    } catch (err) {
      console.error("Sound play failed:", err);
    }

    // Update local state immediately for responsiveness
    setCount(prev => toSafeNumber(prev) + 1);
    pendingHits.current += 1;

    // Visual feedback
    setIsTapping(true);
    setTimeout(() => setIsTapping(false), 100);

    // Add ripple
    const clientX = e.clientX;
    const clientY = e.clientY;
    
    const newRipple = { id: Date.now(), x: clientX, y: clientY };
    setRipples(prev => [...prev, newRipple]);
    setTimeout(() => {
      setRipples(prev => prev.filter(r => r.id !== newRipple.id));
    }, 1000);

    // Debounced sync (Batching)
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(syncWithBackend, 500);
  };

  return (
    <div 
      className="min-h-screen bg-[#fdf6e3] text-[#586e75] font-sans selection:bg-[#eee8d5] overflow-hidden flex flex-col items-center justify-center p-4 relative"
      style={{ cursor: stickCursor }}
    >
      {/* Background Zen Pattern */}
      <div className="absolute inset-0 opacity-5 pointer-events-none" 
           style={{ backgroundImage: 'radial-gradient(#586e75 1px, transparent 1px)', backgroundSize: '40px 40px' }} />

      {/* Header */}
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-12 z-10 select-none"
      >
        <h1 className="text-5xl tracking-tight text-[#073642] mb-2 font-['NostalgicPoliceVibe']">목탁 마음 다스리기</h1>
        <p className="text-lg text-[#93a1a1] mt-4 mb-20">화가 진정될 때까지 두드려보세요...</p>
      </motion.div>

      {/* Main Moktak Area */}
      <div className="relative flex flex-col items-center">
        {/* Count Display */}
        <motion.div 
          key={count}
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="absolute -top-24 flex flex-col items-center select-none"
        >
          <span className="text-7xl font-black text-[#7E4412] tabular-nums drop-shadow-sm">{count}</span>
        </motion.div>

        {/* The Moktak */}
        <motion.button
          onPointerDown={handleTap}
          animate={{ 
            scale: isTapping ? 0.94 : 1,
            rotate: isTapping ? -3 : 0,
            y: isTapping ? 8 : 0
          }}
          transition={{ type: "spring", stiffness: 600, damping: 12 }}
          className="relative w-64 h-64 group outline-none z-10 mt-10"
          id="moktak-button"
          style={{ cursor: 'inherit', touchAction: 'manipulation' }}
        >
          {/* 목탁 몸통 */}
          <div className="absolute inset-0 bg-gradient-to-br from-[#a0522d] via-[#8b4513] to-[#4d2608] rounded-full shadow-[0_30px_70px_rgba(0,0,0,0.5),inset_0_4px_15px_rgba(255,255,255,0.2)] border-b-[5px] border-[#2a1506] z-20">
            
            {/* 광택 */}
            <div className="absolute top-6 left-1/2 -translate-x-1/2 w-3/4 h-1/2 bg-gradient-to-b from-white/25 to-transparent rounded-full blur-xl" />
            
            {/* 목탁 구멍 */}
            <div className="absolute bottom-12 left-1/2 -translate-x-1/2 w-12 h-12 bg-[#1a0d04] rounded-[150%] shadow-inner flex items-center justify-center overflow-hidden">
              {/* <div className="w-full h-1.5 bg-[#0a0502] opacity-60" /> */}
            </div>


          </div>

          {/* 목탁 손잡이 */}
          <div className="absolute -top-12 left-1/2 -translate-x-1/2 w-52 h-40 border-[28px] border-[#994500] rounded-t-[40%] z-0 shadow-md" />
        </motion.button>

        <AnimatePresence> 
          {ripples.map(ripple => (
            <motion.div
              key={ripple.id}
              initial={{ scale: 0, opacity: 0.5 }}
              animate={{ scale: 2, opacity: 0 }}
              exit={{ opacity: 0 }}
              className="absolute pointer-events-none w-10 h-10 bg-white rounded-full z-0"
              style={{ left: ripple.x - 20, top: ripple.y - 20, position: 'fixed' }}
            />
          ))}
        </AnimatePresence>
      </div>

      {/* Footer Stats/Info */}
      <div className="mt-20 grid grid-rows-2 gap-2 text-center max-w-lg w-full">
          <span>오늘 두드려진 목탁 횟수: <span className="text-[#a0522d]">{globalTotal.toLocaleString()}</span></span>
          <span>오늘 방문한 사용자: <span className="text-[#a0522d]">{visitorCount.toLocaleString()}명</span></span>
      </div>

      {/* 초기화 버튼 */}
      <button 
        onClick={() => setCount(0)}
        className="absolute bottom-8 right-8 p-3 bg-[#eee8d5] hover:bg-[#93a1a1] hover:text-white rounded-full transition-colors group"
        title="초기화"
      >
        <RotateCcw size={20} className="group-active:rotate-180 transition-transform duration-500" />
      </button>

      
    
      
    </div>
  );
}
