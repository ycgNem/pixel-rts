// Shape checks for commands (CLAUDE.md rule 2). Commands from other peers are untrusted: before
// the sim acts on one, every field must have the right type and every name must be a real key in
// the data (an own property, so '__proto__' or 'constructor' never match).
import { UNITS } from '../data/units';
import { BUILDINGS } from '../data/buildings';
import { DOCTRINES, TECHS } from '../data/techs';
import { SPECS } from '../data/cities';
import { POWERS } from '../data/powers';
import { EXCHANGE } from '../data/rules';
import type { Command } from './types';

const TECH_IDS = new Set(TECHS.map((t) => t.id));
const DOCTRINE_IDS = new Set(DOCTRINES.map((d) => d.id));
/** most unit ids one command may name */
const MAX_IDS = 1000;

const own = (table: object, k: unknown) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(table, k);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const optNum = (v: unknown) => v === undefined || num(v);
const optBool = (v: unknown) => v === undefined || typeof v === 'boolean';
const ids = (v: unknown) => Array.isArray(v) && v.length <= MAX_IDS && v.every(num);

export function validCommand(c: unknown): c is Command {
  if (!c || typeof c !== 'object') return false;
  const o = c as Record<string, unknown>;
  if (!num(o.p)) return false;
  switch (o.t) {
    case 'move':
    case 'patrol':
    case 'unload':
      return ids(o.ids) && num(o.x) && num(o.y) && optBool(o.q) && optBool(o.am);
    case 'zone':
      return ids(o.ids) && num(o.x) && num(o.y) && num(o.r);
    case 'attack':
    case 'assist':
    case 'load':
      return ids(o.ids) && num(o.target) && optBool(o.q);
    case 'stop':
    case 'hold':
    case 'sellUnits':
      return ids(o.ids);
    case 'build':
      return ids(o.ids) && own(BUILDINGS, o.kind) && num(o.tx) && num(o.ty) && optBool(o.q);
    case 'train':
      return num(o.at) && optBool(o.city) && own(UNITS, o.kind) && num(o.n);
    case 'cancelTrain':
      return num(o.at) && optBool(o.city) && num(o.index);
    case 'rally':
      return num(o.at) && optBool(o.city) && num(o.x) && num(o.y);
    case 'cancelBuild':
    case 'sell':
      return num(o.id);
    case 'research':
      return typeof o.tech === 'string' && TECH_IDS.has(o.tech);
    case 'cancelResearch':
      return num(o.index);
    case 'doctrine':
      return typeof o.id === 'string' && DOCTRINE_IDS.has(o.id);
    case 'spec':
      return num(o.city) && own(SPECS, o.spec);
    case 'ability':
      return ids(o.ids) && optNum(o.x) && optNum(o.y);
    case 'power':
      return own(POWERS, o.power) && optNum(o.x) && optNum(o.y);
    case 'trade':
      return own(EXCHANGE.trades, o.trade);
    case 'gift':
      return num(o.to) && num(o.cash) && num(o.oil) && o.cash >= 0 && o.oil >= 0;
    case 'surrender':
      return true;
    case 'insurge':
      return num(o.city);
    case 'contract':
      return num(o.city) && num(o.bid) && o.bid > 0;
    default:
      return false;
  }
}
