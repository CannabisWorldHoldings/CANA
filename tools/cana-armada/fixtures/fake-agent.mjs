let input=''; for await (const chunk of process.stdin) input += chunk;
const parsed = JSON.parse(input);
const id = process.argv[2] ?? 'a';
console.log(JSON.stringify({ agent:id, lane:parsed.lane, mechanism:id==='b'?'stronger':'baseline', evidence:['fixture-only'] }));
