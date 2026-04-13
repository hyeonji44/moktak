/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Howl } from 'howler';
import { Heart, Flame, Info, Trophy } from 'lucide-react';
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
    incrementApplied: toSafeNumber(data?.incrementApplied),
  };
}

async function readResponseBody(res: Response) {
  const text = await res.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
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
  
  // 마우스 포인터를 목탁 손잡이로
  const stickCursor = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='76' height='76' viewBox='0 0 76 76'><path d='M12 64 L64 12' stroke='%23c7772f' stroke-width='10' stroke-linecap='round'/><circle cx='64' cy='12' r='7' fill='%23c7772f'/></svg>") 64 12, auto`;

  // For batching updates to backend
  const pendingHits = useRef(0);

  const fetchTotals = useCallback(() => {
    return fetch(`/api/hits/total?ts=${Date.now()}`, { cache: 'no-store' })
      .then(async res => {
        const data = await readResponseBody(res);
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
    fetch(`/api/hits/user?userId=${encodeURIComponent(userId)}&ts=${Date.now()}`, { cache: 'no-store' })
      .then(async res => {
        const data = await readResponseBody(res);
        if (!res.ok) {
          throw new Error(`Failed to fetch hits: ${res.status} ${JSON.stringify(data)}`);
        }
        const stats = readCountPayload(data);
        setCount(prev => Math.max(toSafeNumber(prev), stats.count));
        setGlobalTotal(prev => Math.max(toSafeNumber(prev), stats.globalTotal));
        setVisitorCount(prev => Math.max(toSafeNumber(prev), stats.visitorCount));
      })
      .catch(err => console.error("Failed to fetch hits:", err));

    fetchTotals().catch(err => console.error("Failed to fetch total:", err));

    const interval = setInterval(() => {
      fetchTotals().catch(err => console.error("Failed to fetch total:", err));
    }, 5000);

    return () => clearInterval(interval);
  }, [fetchTotals, userId]);

  const syncWithBackend = useCallback(() => {
    const increment = pendingHits.current || 1;
    pendingHits.current = 0;

    fetch(`/api/hits/user?userId=${encodeURIComponent(userId)}&increment=${increment}&ts=${Date.now()}`, {
      cache: 'no-store',
    })
      .then(async res => {
        const data = await readResponseBody(res);
        if (!res.ok) {
          throw new Error(`Failed to sync hits: ${res.status} ${JSON.stringify(data)}`);
        }
        const stats = readCountPayload(data);
        setCount(prev => Math.max(toSafeNumber(prev), stats.count));
        setGlobalTotal(prev => Math.max(toSafeNumber(prev), stats.globalTotal));
        setVisitorCount(prev => Math.max(toSafeNumber(prev), stats.visitorCount));
        fetchTotals().catch(err => console.error("Failed to refresh total after sync:", err));
      })
      .catch(err => {
        console.error("Sync failed, restoring pending hits:", err);
        pendingHits.current += increment;
    });
  }, [fetchTotals, userId]);

  const handleTap = (e: React.PointerEvent<HTMLButtonElement>) => {
    // Play sound
    try {
      moktakSound.play();
    } catch (err) {
      console.error("Sound play failed:", err);
    }

    // Update local state immediately for responsiveness
    setCount(prev => toSafeNumber(prev) + 1);
    setGlobalTotal(prev => toSafeNumber(prev) + 1);
    pendingHits.current = 1;

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

    syncWithBackend();
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
        <h1 className="text-5xl tracking-tight text-[#073642] mb-2 font-['NostalgicPoliceVibe']">목탁소리</h1>
        <p className="text-lg text-[#93a1a1] mt-4 mb-20">화가 진정될 때까지 쳐보세요...</p>
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
          {/* 내가 두드린 횟수 */}
          <span className="text-6xl font-black text-[#8b4513] tabular-nums drop-shadow-sm">{count}</span>
        </motion.div>

        {/* 목탁 */}
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
            </div>


          </div>

          {/* 목탁 손잡이 */}
          <div className="absolute -top-12 left-1/2 -translate-x-1/2 w-52 h-40 border-[28px] border-[#8b4513] rounded-t-[40%] z-0 shadow-md" />
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
          <span>오늘 울려펴진 목탁소리: <span className="text-[#a0522d]">{globalTotal.toLocaleString()}</span></span>
          <span>오늘 방문한 목탁러: <span className="text-[#a0522d]">{visitorCount.toLocaleString()}명</span></span>
      </div>

      <a
        href="mailto:hyeonji443@gmail.com"
        className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs sm:text-sm text-[#93a1a1] hover:text-[#7E4412] transition-colors z-10"
      >
        문의 | hyeonji443@gmail.com
      </a>
    </div>
  );
}
