// data/i18n/country-lookup.js
//
// country_map.js(root/scripts, 리비아 등 이미 직접 추가해두신 상태)를 그대로 참조해서
// 국가명 한글 변환과 flag-icons 코드 조회를 한 곳에서 제공합니다.

import COUNTRY_MAP from "../../scripts/country_map.js"; // root/scripts/country_map.js
import COUNTRY_FLAG_MAP from "./country-flag-map.js";

/**
 * country 필드값을 한글로 변환합니다. 매핑이 없으면 원문 그대로 반환합니다.
 */
export function getCountryName(country) {
  if (!country) return null;
  return COUNTRY_MAP[country] ?? country;
}

/**
 * flag-icons용 코드를 반환합니다. 없으면 null
 * (호출부에서 null이면 public/assets/fallback/flag.svg로 대체하세요)
 */
export function getFlagCode(country) {
  if (!country) return null;
  return COUNTRY_FLAG_MAP[country] ?? null;
}