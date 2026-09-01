let input=''; for await (const chunk of process.stdin) input += chunk;
const parsed = JSON.parse(input);
const id = process.argv[2] ?? 'a';
console.log(JSON.stringify({
  agent: id,
  lane: parsed.lane,
  mechanism: id === 'b' ? 'stronger' : 'baseline',
  evidence: ['fixture-only'],
  inheritedSecret: process.env.CANA_FAKE_SECRET ?? null,
  inheritedHome: process.env.HOME ?? null,
  effectAuthority: process.env.CANA_ARMADA_EFFECT_AUTHORITY ?? null,
}));
