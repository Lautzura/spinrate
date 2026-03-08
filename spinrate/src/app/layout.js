export const metadata = { title: 'Spinrate', description: 'Reseñas de música' };

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body style={{ margin: 0, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", background: "#f7f7fb" }}>
        {children}
      </body>
    </html>
  );
}
