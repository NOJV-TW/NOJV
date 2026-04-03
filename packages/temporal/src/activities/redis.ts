import { getRedis, scoreboard, cooldown, cache } from "@nojv/redis";

export { getRedis };

export const updateScoreboard = scoreboard.updateScoreboard;
export const getScoreboard = scoreboard.getScoreboard;
export const setCooldown = cooldown.setCooldown;
export const checkCooldown = cooldown.checkCooldown;
export const cacheGet = cache.cacheGet;
export const cacheSet = cache.cacheSet;
export const cacheDel = cache.cacheDel;
