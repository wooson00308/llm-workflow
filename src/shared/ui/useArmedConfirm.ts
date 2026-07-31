import { useEffect, useRef, useState } from "react";

const DEFAULT_TIMEOUT_MS = 3_500;

/** 실수 클릭 방지용 2단계 확인. 첫 fire는 무장만 하고, 제한 시간 안의 두 번째 fire가 실제 실행한다. */
export function useArmedConfirm(timeoutMs = DEFAULT_TIMEOUT_MS) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  function disarm() {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    setArmed(false);
  }

  function fire(action: () => void) {
    if (!armed) {
      setArmed(true);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        setArmed(false);
      }, timeoutMs);
      return;
    }
    disarm();
    action();
  }

  return { armed, disarm, fire };
}
