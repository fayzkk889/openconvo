import { ImageResponse } from 'next/og';
import { getSiteUrl } from '@/lib/site-url';

export const runtime = 'edge';
export const alt = 'OpenConvo - open-source AI chat workspace';
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = 'image/png';

export default function Image() {
  const markUrl = new URL('/mark-transparent.png', getSiteUrl()).toString();

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#050506',
          color: '#f6f6f7',
          padding: 64,
          fontFamily: 'Inter, Arial, sans-serif',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0) 45%), radial-gradient(circle at 82% 18%, rgba(255,255,255,0.12), transparent 28%)',
          }}
        />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 22,
            position: 'relative',
          }}
        >
          <div
            style={{
              width: 92,
              height: 92,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 18,
              border: '1px solid #2d2e34',
              background: '#101113',
            }}
          >
            <img src={markUrl} alt="" width={68} height={68} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 44, fontWeight: 800, letterSpacing: 0 }}>
              OpenConvo
            </div>
            <div style={{ marginTop: 8, fontSize: 24, color: '#a7a9b0' }}>
              Open-source AI chat workspace
            </div>
          </div>
        </div>

        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              maxWidth: 960,
              fontSize: 74,
              lineHeight: 1.02,
              fontWeight: 800,
              letterSpacing: 0,
            }}
          >
            Local-first chat for free models, files, and web research.
          </div>
          <div
            style={{
              marginTop: 28,
              display: 'flex',
              gap: 12,
              fontSize: 26,
              color: '#d9d9de',
            }}
          >
            {['Verified free models', 'BYOK', 'Self-hostable'].map((item) => (
              <div
                key={item}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  border: '1px solid #2d2e34',
                  borderRadius: 999,
                  padding: '12px 18px',
                  background: '#101113',
                }}
              >
                {item}
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    size
  );
}
