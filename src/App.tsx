/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Howl } from 'howler';
import moktakSoundFile from '../sound.wav'; // 목탁소리 

const STORAGE_USER_ID_KEY = 'moktak-user-id';
const DAILY_COUNT_LIMIT = 10000; // 일일 한도 횟수
const LIMIT_TOAST_COOLDOWN_MS = 2000;
const DRAG_START_DISTANCE_PX = 22;
const DRAG_REPEAT_DISTANCE_PX = 30;
const DRAG_REPEAT_INTERVAL_MS = 90;

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

function hasCountPayload(data: any) {
  return (
    data &&
    typeof data === 'object' &&
    ['count', 'currentCount', 'globalTotal', 'total', 'visitorCount', 'visitors'].some(key =>
      Number.isFinite(Number(data?.[key])),
    )
  );
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
  preload: true,
});

export default function App() {
  const [count, setCount] = useState(0);
  const [globalTotal, setGlobalTotal] = useState(0);
  const [visitorCount, setVisitorCount] = useState(0);
  const [isTapping, setIsTapping] = useState(false);
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([]);
  const [toastMessage, setToastMessage] = useState('');
  const [isUpdateNoteOpen, setIsUpdateNoteOpen] = useState(false);
  const [userId] = useState(getOrCreateUserId);
  
  // 마우스 포인터를 목탁 손잡이로
  const stickCursor = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='76' height='76' viewBox='0 0 76 76'><path d='M12 64 L64 12' stroke='%23c7772f' stroke-width='10' stroke-linecap='round'/><circle cx='64' cy='12' r='7' fill='%23c7772f'/></svg>") 64 12, auto`;

  // For batching updates to backend
  const pendingHits = useRef(0);
  const countRef = useRef(0);
  const toastTimerRef = useRef<number | null>(null);
  const lastLimitToastAtRef = useRef(0);
  const activePointerIdRef = useRef<number | null>(null);
  const lastDragHitAtRef = useRef(0);
  const pointerDownPositionRef = useRef<{ x: number; y: number } | null>(null);
  const lastDragHitPositionRef = useRef<{ x: number; y: number } | null>(null);
  const isDragActiveRef = useRef(false);
  const isSyncingRef = useRef(false);
  const tapResetTimerRef = useRef<number | null>(null);
  const tapAnimationFrameRef = useRef<number | null>(null);

  const showToast = useCallback((message: string) => {
    setToastMessage(message);

    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }

    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage('');
      toastTimerRef.current = null;
    }, 2200);
  }, []);

  const fetchTotals = useCallback(() => {
    return fetch(`/api/hits/total?ts=${Date.now()}`, { cache: 'no-store' })
      .then(async res => {
        const data = await readResponseBody(res);
        if (!res.ok) {
          throw new Error(`Failed to fetch total: ${res.status} ${JSON.stringify(data)}`);
        }
        if (!hasCountPayload(data)) {
          throw new Error(`Invalid total payload: ${JSON.stringify(data)}`);
        }
        const stats = readCountPayload(data);
        setGlobalTotal(stats.globalTotal);
        setVisitorCount(stats.visitorCount);
      });
  }, []);

  // Fetch initial count
  useEffect(() => {
    countRef.current = count;
  }, [count]);

  useEffect(() => {
    fetch(`/api/hits/user?userId=${encodeURIComponent(userId)}&ts=${Date.now()}`, { cache: 'no-store' })
      .then(async res => {
        const data = await readResponseBody(res);
        if (!res.ok) {
          throw new Error(`Failed to fetch hits: ${res.status} ${JSON.stringify(data)}`);
        }
        if (!hasCountPayload(data)) {
          throw new Error(`Invalid hits payload: ${JSON.stringify(data)}`);
        }
        const stats = readCountPayload(data);
        const nextCount = Math.min(DAILY_COUNT_LIMIT, stats.count);
        countRef.current = nextCount;
        setCount(nextCount);
        setGlobalTotal(stats.globalTotal);
        setVisitorCount(stats.visitorCount);
      })
      .catch(err => console.error("Failed to fetch hits:", err));

    fetchTotals().catch(err => console.error("Failed to fetch total:", err));

    const interval = setInterval(() => {
      fetchTotals().catch(err => console.error("Failed to fetch total:", err));
    }, 5000);

    return () => clearInterval(interval);
  }, [fetchTotals, userId]);

  const syncWithBackend = useCallback(() => {
    if (isSyncingRef.current) {
      return;
    }

    const increment = pendingHits.current;
    if (increment <= 0) {
      return;
    }

    isSyncingRef.current = true;
    pendingHits.current = 0;

    fetch(`/api/hits/user?userId=${encodeURIComponent(userId)}&increment=${increment}&ts=${Date.now()}`, {
      cache: 'no-store',
    })
      .then(async res => {
        const data = await readResponseBody(res);
        if (!res.ok) {
          throw new Error(`Failed to sync hits: ${res.status} ${JSON.stringify(data)}`);
        }
        if (!hasCountPayload(data)) {
          throw new Error(`Invalid sync payload: ${JSON.stringify(data)}`);
        }
        const stats = readCountPayload(data);
        const nextCount = Math.min(DAILY_COUNT_LIMIT, stats.count);
        countRef.current = nextCount;
        setCount(nextCount);
        setGlobalTotal(stats.globalTotal);
        setVisitorCount(stats.visitorCount);
      })
      .catch(err => {
        console.error("Sync failed, restoring pending hits:", err);
        pendingHits.current += increment;
      })
      .finally(() => {
        isSyncingRef.current = false;
        if (pendingHits.current > 0) {
          syncWithBackend();
          return;
        }
        fetchTotals().catch(err => console.error("Failed to refresh total after sync:", err));
      });
  }, [fetchTotals, userId]);

  const registerHit = useCallback((clientX: number, clientY: number) => {
    if (countRef.current >= DAILY_COUNT_LIMIT) {
      const now = Date.now();
      if (now - lastLimitToastAtRef.current >= LIMIT_TOAST_COOLDOWN_MS) {
        showToast('목탁은 하루에 10,000회만 칠 수 있어요.');
        lastLimitToastAtRef.current = now;
      }
      return;
    }

    // Play sound
    try {
      moktakSound.play();
    } catch (err) {
      console.error("Sound play failed:", err);
    }

    // Update local state immediately for responsiveness
    const nextCount = Math.min(DAILY_COUNT_LIMIT, toSafeNumber(countRef.current) + 1);
    const appliedIncrement = nextCount - toSafeNumber(countRef.current);

    if (appliedIncrement <= 0) {
      return;
    }

    countRef.current = nextCount;
    setCount(nextCount);
    setGlobalTotal(prev => toSafeNumber(prev) + 1);
    pendingHits.current += appliedIncrement;

    // Visual feedback
    if (tapAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(tapAnimationFrameRef.current);
    }
    if (tapResetTimerRef.current !== null) {
      window.clearTimeout(tapResetTimerRef.current);
    }

    setIsTapping(false);
    tapAnimationFrameRef.current = window.requestAnimationFrame(() => {
      setIsTapping(true);
      tapAnimationFrameRef.current = null;
      tapResetTimerRef.current = window.setTimeout(() => {
        setIsTapping(false);
        tapResetTimerRef.current = null;
      }, 100);
    });

    // Add ripple
    const newRipple = { id: Date.now(), x: clientX, y: clientY };
    setRipples(prev => [...prev, newRipple]);
    setTimeout(() => {
      setRipples(prev => prev.filter(r => r.id !== newRipple.id));
    }, 1000);

    syncWithBackend();
  }, [showToast, syncWithBackend]);

  const handleTap = (e: React.PointerEvent<HTMLButtonElement>) => {
    activePointerIdRef.current = e.pointerId;
    pointerDownPositionRef.current = { x: e.clientX, y: e.clientY };
    lastDragHitPositionRef.current = { x: e.clientX, y: e.clientY };
    isDragActiveRef.current = false;
    lastDragHitAtRef.current = Date.now();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    registerHit(e.clientX, e.clientY);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (activePointerIdRef.current !== e.pointerId || e.buttons === 0) {
      return;
    }

    const pointerDownPosition = pointerDownPositionRef.current;
    const lastDragHitPosition = lastDragHitPositionRef.current;
    if (!pointerDownPosition || !lastDragHitPosition) {
      return;
    }

    const totalDistance = Math.hypot(
      e.clientX - pointerDownPosition.x,
      e.clientY - pointerDownPosition.y,
    );
    if (!isDragActiveRef.current) {
      if (totalDistance < DRAG_START_DISTANCE_PX) {
        return;
      }
      isDragActiveRef.current = true;
    }

    const now = Date.now();
    if (now - lastDragHitAtRef.current < DRAG_REPEAT_INTERVAL_MS) {
      return;
    }

    const stepDistance = Math.hypot(
      e.clientX - lastDragHitPosition.x,
      e.clientY - lastDragHitPosition.y,
    );
    if (stepDistance < DRAG_REPEAT_DISTANCE_PX) {
      return;
    }

    lastDragHitAtRef.current = now;
    lastDragHitPositionRef.current = { x: e.clientX, y: e.clientY };
    registerHit(e.clientX, e.clientY);
  };

  const handlePointerEnd = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (activePointerIdRef.current !== e.pointerId) {
      return;
    }

    activePointerIdRef.current = null;
    pointerDownPositionRef.current = null;
    lastDragHitPositionRef.current = null;
    isDragActiveRef.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
      if (tapResetTimerRef.current !== null) {
        window.clearTimeout(tapResetTimerRef.current);
      }
      if (tapAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(tapAnimationFrameRef.current);
      }
    };
  }, []);

  return (
    <div 
      className="h-screen min-h-[100svh] bg-[#fdf6e3] text-[#586e75] font-sans selection:bg-[#eee8d5] overflow-hidden flex flex-col items-center justify-center p-4 relative select-none"
      style={{ cursor: stickCursor, WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}
    >
      {/* Background Zen Pattern */}
      <div className="absolute inset-0 opacity-5 pointer-events-none" 
           style={{ backgroundImage: 'radial-gradient(#586e75 1px, transparent 1px)', backgroundSize: '40px 40px' }} />

      <button
        type="button"
        onClick={() => setIsUpdateNoteOpen(true)}
        className="absolute right-4 top-4 z-20 rounded-full border border-[#d6c5a4] bg-[#f8efda]/95 px-4 py-2 text-sm font-medium text-[#7E4412] shadow-sm transition hover:bg-[#f3e5c5]"
      >
        업데이트 노트
      </button>

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
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onContextMenu={e => e.preventDefault()}
          animate={{ 
            scale: isTapping ? 0.94 : 1,
            rotate: isTapping ? -3 : 0,
            y: isTapping ? 8 : 0
          }}
          transition={{ type: "spring", stiffness: 600, damping: 12 }}
          className="relative w-64 h-64 group outline-none z-10 mt-10 select-none"
          id="moktak-button"
          style={{ cursor: 'inherit', touchAction: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}
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
        className="absolute left-1/2 -translate-x-1/2 text-xs sm:text-sm text-[#93a1a1] hover:text-[#7E4412] transition-colors z-10 whitespace-nowrap"
        style={{ bottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      >
        문의 | hyeonji443@gmail.com
      </a>

      <AnimatePresence>
        {toastMessage ? (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.2 }}
            className="fixed left-1/2 top-6 z-30 -translate-x-1/2 rounded-full bg-[#073642] px-5 py-3 text-sm font-medium text-[#fdf6e3] shadow-lg"
          >
            {toastMessage}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {isUpdateNoteOpen ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 flex items-center justify-center bg-[#073642]/45 px-4"
            onClick={() => setIsUpdateNoteOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              className="w-full max-w-md rounded-[28px] bg-[#fff] p-6 text-[#586e75] shadow-[0_24px_80px_rgba(7,54,66,0.25)]"
              onClick={e => e.stopPropagation()}
            >
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h2 className="mt-2 text-2xl font-bold text-[#073642]">업데이트 노트</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setIsUpdateNoteOpen(false)}
                  className="rounded-full bg-[#f2f2f2] px-3 py-1 text-sm text-[#586e75] transition hover:bg-[#e6deca]"
                >
                  닫기
                </button>
              </div>

              <div className="space-y-4 text-sm leading-6">
                <div className="rounded-2xl bg-[#f2f2f2] p-4">
                  <p className="font-semibold text-[#7E4412]">2026.04.16</p>
                  <p className="mt-2">- 하루에 목탁을 칠 수 있는 최대 한도를 설정했어요.</p>
                  <p>- 드래그로도 목탁을 칠 수 있게 액션을 추가했어요.</p>
                </div>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
