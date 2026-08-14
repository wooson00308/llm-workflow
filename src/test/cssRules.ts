/**
 * `src/App.css`를 문자열로 읽어 규칙 하나를 선택자로 집고 그 본문의 선언을 돌려주는 판독기.
 *
 * 스타일 회귀 검사가 이것을 함께 쓴다. 판독기를 나눠 쓰는 이유는 같은 계열 결함의 검사가 서로 다른
 * 어법으로 갈라지지 않게 하기 위해서다. `boardCardOverflow.test.ts`(SPEC-021)가 처음 쓴 것을 옮겨
 * 담았고, 파싱 동작은 그대로다.
 *
 * 검사는 파일 전체에서 문자열을 찾지 않는다. 규칙 하나를 선택자로 집어 그 본문 안에서만 확인한다.
 * 다른 규칙에 같은 선언이 있어도 통과하지 않게 하기 위해서다. 같은 선택자의 규칙이 둘 이상이면
 * 실패시킨다. 규칙이 다시 쓰이거나 뒤에서 덮이는 것도 이 결함들의 재발 경로이기 때문이다.
 */
import cssText from "../App.css?raw";

type Rule = { selector: string; body: string };

function collectRules(css: string): Rule[] {
  const rules: Rule[] = [];
  let prelude = "";
  let index = 0;

  while (index < css.length) {
    const char = css[index];
    if (char !== "{") {
      if (char === "}") prelude = "";
      else prelude += char;
      index += 1;
      continue;
    }

    let depth = 0;
    let end = index;
    while (end < css.length) {
      if (css[end] === "{") depth += 1;
      else if (css[end] === "}" && --depth === 0) break;
      end += 1;
    }

    const body = css.slice(index + 1, end);
    const selector = prelude.replace(/\s+/g, " ").trim();
    if (selector.startsWith("@")) rules.push(...collectRules(body));
    else rules.push({ selector, body });

    prelude = "";
    index = end + 1;
  }

  return rules;
}

const rules = collectRules(cssText.replace(/\/\*[\s\S]*?\*\//g, ""));

function declarationsFromRules(sourceRules: Rule[], selector: string, sourceName: string) {
  const matched = sourceRules.filter((rule) => rule.selector === selector);
  if (matched.length !== 1) {
    throw new Error(`\`${selector}\` 규칙이 ${sourceName}에 ${matched.length}개 있습니다. 정확히 하나여야 합니다.`);
  }

  const found = new Map<string, string>();
  for (const declaration of matched[0].body.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon < 0) continue;
    const property = declaration.slice(0, colon).replace(/\s+/g, " ").trim();
    if (property) found.set(property, declaration.slice(colon + 1).replace(/\s+/g, " ").trim());
  }
  return found;
}

export function declarationsFrom(css: string, selector: string, sourceName = "CSS") {
  return declarationsFromRules(collectRules(css.replace(/\/\*[\s\S]*?\*\//g, "")), selector, sourceName);
}

export function declarationsOf(selector: string) {
  return declarationsFromRules(rules, selector, "App.css");
}
