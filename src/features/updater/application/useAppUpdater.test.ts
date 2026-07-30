import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAppUpdater } from "./useAppUpdater";
import type { UpdaterGateway } from "../domain/types";

describe("useAppUpdater", () => {
  it("separates checking, installation and explicit restart", async () => {
    const gateway: UpdaterGateway = {
      check: vi.fn().mockResolvedValue({ version: "0.2.0", notes: null }),
      downloadAndInstall: vi.fn(async (onProgress) => onProgress(100)),
      restart: vi.fn().mockResolvedValue(undefined),
    };
    const { result } = renderHook(() => useAppUpdater(gateway));

    await act(() => result.current.check());
    expect(result.current.phase).toBe("available");
    expect(result.current.version).toBe("0.2.0");

    await act(() => result.current.install());
    expect(result.current.phase).toBe("ready");
    expect(gateway.restart).not.toHaveBeenCalled();

    await act(() => result.current.restart());
    expect(gateway.restart).toHaveBeenCalledOnce();
  });
});
