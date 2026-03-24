import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Navbar        from './components/Layout/Navbar';
import CorpsOverview from './pages/CorpsOverview';
import MembersList   from './pages/MembersList';
import MemberDetail  from './pages/MemberDetail';
import ImportData    from './pages/ImportData';
import EmailReports  from './pages/EmailReports';
import PrintView     from './pages/PrintView';
import './index.css';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Print view — standalone page, no navbar */}
        <Route path="/print" element={<PrintView />} />

        {/* Main app shell */}
        <Route path="/*" element={
          <div style={styles.shell}>
            <Navbar />
            <main style={styles.main}>
              <Routes>
                <Route path="/"            element={<CorpsOverview />} />
                <Route path="/members"     element={<MembersList />}   />
                <Route path="/members/:id" element={<MemberDetail />}  />
                <Route path="/upload"      element={<ImportData />}    />
                <Route path="/email"       element={<EmailReports />}  />
              </Routes>
            </main>
          </div>
        } />
      </Routes>
    </BrowserRouter>
  );
}

const styles = {
  shell: {
    minHeight: '100vh',
    background: '#f4f7fb',
    display: 'flex',
    flexDirection: 'column',
  },
  main: { flex: 1, overflow: 'auto' },
};
