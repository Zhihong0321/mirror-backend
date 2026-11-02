import test from 'node:test';
import assert from 'node:assert/strict';
import { blacklistReason } from './lead-blacklist.ts';

test('each group catches its leads by category or by name', () => {
  const cases: Array<[string, string | null, string]> = [
    ['Pejabat Pos Taman Daya', 'Post office', 'government'],
    ['Sekolah Kebangsaan Teluk Pulai', 'Government school', 'government'],
    ['Maybank (Kluang)', 'Bank', 'bank_finance'],
    ['Ar-Rahnu YaPEIM Kluang', 'Pawn shop', 'bank_finance'],
    ['Bata AEON Taman Universiti', 'Shoe store', 'hypermarket_mall'],
    ["Harold's @ Lotus's Bukit Indah", 'Bakery', 'hypermarket_mall'],
    ['99 Speedmart 3242 (JH) Taman Baiduri', 'Convenience store', 'chain_store'],
    ['MR.DIY', 'Home improvement store', 'chain_store'],
    ['LionMas Kipmall Kota Tinggi', 'Furniture store', 'chain_store'],
    ['AEON BiG Batu Pahat', 'Hypermarket', 'hypermarket_mall'],
    ['Coolblog - Econsave Kota Tinggi', 'Bubble tea store', 'hypermarket_mall'],
    ['ZUS Coffee - Taman Universiti, Skudai', 'Cafe', 'chain_fnb'],
    ['KFC Taman Daya', 'Restaurant', 'chain_fnb'],
    ['J&T Express Skudai', 'Courier service', 'telco_courier'],
    // A chain shop at a petrol station is still its chain.
    ['Subway @ Caltex Taman Daya', 'Sandwich shop', 'chain_fnb'],
    ['FamilyMart Petron Kangkar Pulai', 'Convenience store', 'chain_store'],
    ['COWAY JOHOR BAHRU', 'Water filter supplier', 'franchise_agent'],
    ['Pacific Risk Agency', 'Insurance agency', 'franchise_agent'],
    ['Pangsapuri Pulai', 'Apartment building', 'not_a_business'],
    ['Taman Sri Pulai', null, 'not_a_business'],
    ['Solstice Solar Sdn Bhd', 'Solar energy company', 'competitor_solar'],
    ['Sunlight Solar Power Sdn.Bhd.', null, 'competitor_solar'],
  ];
  for (const [name, category, group] of cases) assert.equal(blacklistReason(name, category), group, name);
});

test('the leads a solar EPC sells to stay in', () => {
  const cases: Array<[string, string | null]> = [
    ['Zhin Heng Hardware & Trading Sdn Bhd', 'Hardware store'],
    ['Probase Manufacturing Sdn Bhd', 'Manufacturer'],
    ['Frontier Food Industries Sdn. Bhd.', 'Food processing company'],
    ['SKS Mart Skudai', 'Supermarket'],
    ['Sky Furniture & Decoration', 'Furniture store'],
    ['Kilang', null],
    // Petrol stations are clients (2026-10-26).
    ['Petron Taman Saujana', 'Petrol Station'],
    ['PETRONAS - Nusa Perintis', 'Gas station'],
    ['Shell', null],
    ['Hawk Tyre Service Sdn Bhd - Shell', 'Tire shop'],
    // A place-name start only counts when Google gave no category.
    ['Taman Daya Hardware', 'Hardware store'],
    // "Solar" alone is a tint, watch or gas brand, not a competitor.
    ['Solar Gard Car Tint', 'Window tinting service'],
    ['Solar Gas Beranang - Filling Plant', null],
    // A brand given as a landmark is not the business.
    ['HS TYRES AND SERVICE CENTRE (beside burger king)', 'Auto repair shop'],
    ['Kedai Runcit Ali (sebelah Maybank)', 'Grocery store'],
  ];
  for (const [name, category] of cases) assert.equal(blacklistReason(name, category), null, name);
});
