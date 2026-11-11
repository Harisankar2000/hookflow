// Demo webhook receiver. It verifies the HookFlow signature and can fail on
// purpose so you can watch retries and the dead letter queue.
//
//   WEBHOOK_SECRET=whsec_... FAIL_RATE=0.5 npm run receiver
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

const port = Number(process.env.RECEIVER_PORT ?? 4100);
const secret = process.env.WEBHOOK_SECRET;
const failRate = Number(process.env.FAIL_RATE ?? 0);

function verify(headers, body) {
  const timestamp = Number(headers['x-hookflow-timestamp']);
  const signature = String(headers['x-hookflow-signature'] ?? '');
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) return false;
  const expected = Buffer.from(`v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`);
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    const delivery = req.headers['x-hookflow-delivery'];
    if (secret && !verify(req.headers, body)) {
      console.log(`401 bad signature   delivery=${delivery}`);
      res.writeHead(401).end('bad signature');
      return;
    }
    if (Math.random() < failRate) {
      console.log(`500 simulated fail  delivery=${delivery}`);
      res.writeHead(500).end('simulated failure');
      return;
    }
    console.log(`200 received        delivery=${delivery} ${body}`);
    res.writeHead(200).end('ok');
  });
}).listen(port, () => {
  console.log(`Receiver on http://localhost:${port} (fail rate ${failRate}, signature check ${secret ? 'on' : 'off'})`);
});
