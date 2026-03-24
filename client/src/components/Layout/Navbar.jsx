import { Link, useLocation } from 'react-router-dom';

const NAV_LINKS = [
  { to: '/',          label: 'Corps Overview' },
  { to: '/members',   label: 'Members'        },
  { to: '/upload',    label: 'Import Data'    },
  { to: '/email',     label: 'Email Reports'  },
];

export default function Navbar() {
  const { pathname } = useLocation();

  return (
    <nav style={styles.nav}>
      <div style={styles.brand}>
        <span style={styles.logo}>🚑</span>
        <span style={styles.title}>ASVAС Dashboard</span>
      </div>
      <div style={styles.links}>
        {NAV_LINKS.map(link => (
          <Link
            key={link.to}
            to={link.to}
            style={{
              ...styles.link,
              ...(pathname === link.to ? styles.activeLink : {}),
            }}
          >
            {link.label}
          </Link>
        ))}
        <Link to="/print" target="_blank" style={{ ...styles.link, ...styles.printLink }}>
          🖨 Print View
        </Link>
      </div>
    </nav>
  );
}

const styles = {
  nav: {
    background: '#1a3a6b',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 24px',
    height: 56,
    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
    position: 'sticky',
    top: 0,
    zIndex: 100,
  },
  brand: { display: 'flex', alignItems: 'center', gap: 10 },
  logo:  { fontSize: 24 },
  title: { fontSize: 18, fontWeight: 700, letterSpacing: '-0.5px' },
  links: { display: 'flex', gap: 4 },
  link: {
    color: 'rgba(255,255,255,0.8)',
    textDecoration: 'none',
    padding: '6px 14px',
    borderRadius: 6,
    fontSize: 14,
    fontWeight: 500,
    transition: 'background 0.15s',
  },
  activeLink: {
    background: 'rgba(255,255,255,0.15)',
    color: '#fff',
  },
  printLink: {
    marginLeft: 12,
    border: '1px solid rgba(255,255,255,0.3)',
  },
};
