let input=''; for await (const chunk of process.stdin) input += chunk;
const parsed = JSON.parse(input);
const candidate = parsed.candidateOutput;
console.log(JSON.stringify({ verifierId:'verifier:fixture', score:candidate.agent==='b'?0.9:0.4, verdict:'PASS', reasons:['fixture process court'] }));
