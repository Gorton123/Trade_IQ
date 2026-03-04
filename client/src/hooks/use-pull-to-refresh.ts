import { useEffect, useRef, useState, useCallback } from "react";

export function usePullToRefresh(onRefresh: () => Promise<void> | void) {
  const [isPulling, setIsPulling] = useState(false);
  const [pullProgress, setPullProgress] = useState(0);
  const startY = useRef(0);
  const pulling = useRef(false);

  const handleRefresh = useCallback(async () => {
    setIsPulling(true);
    try {
      await onRefresh();
    } finally {
      setIsPulling(false);
      setPullProgress(0);
    }
  }, [onRefresh]);

  useEffect(() => {
    const threshold = 80;
    
    const handleTouchStart = (e: TouchEvent) => {
      if (window.scrollY === 0) {
        startY.current = e.touches[0].clientY;
        pulling.current = true;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!pulling.current || window.scrollY > 0) {
        pulling.current = false;
        setPullProgress(0);
        return;
      }
      
      const currentY = e.touches[0].clientY;
      const diff = currentY - startY.current;
      
      if (diff > 0 && diff < threshold * 2) {
        setPullProgress(Math.min(diff / threshold, 1));
      }
    };

    const handleTouchEnd = () => {
      if (pullProgress >= 1 && !isPulling) {
        handleRefresh();
      } else {
        setPullProgress(0);
      }
      pulling.current = false;
    };

    document.addEventListener("touchstart", handleTouchStart, { passive: true });
    document.addEventListener("touchmove", handleTouchMove, { passive: true });
    document.addEventListener("touchend", handleTouchEnd);

    return () => {
      document.removeEventListener("touchstart", handleTouchStart);
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", handleTouchEnd);
    };
  }, [pullProgress, isPulling, handleRefresh]);

  return { isPulling, pullProgress };
}
