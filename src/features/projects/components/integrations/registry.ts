import { DreamCard } from "./DreamCard";
import { HeartbeatCard } from "./HeartbeatCard";
import type { IntegrationDefinition } from "./IntegrationCard";

/**
 * 앱에 내장된 연동 목록. 고정 배열이고 동적 로딩은 하지 않는다.
 *
 * 새 연동은 이 배열에 항목 하나와 본문 컴포넌트 하나를 더하는 것으로 끝난다. 섹션·카드 골격·배지·
 * 경고 컴포넌트는 고치지 않는다.
 */
export const integrations: IntegrationDefinition[] = [
  { id: "heartbeat", Card: HeartbeatCard },
  { id: "dream", Card: DreamCard },
];
