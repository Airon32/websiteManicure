import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import ClientPortal from './pages/ClientPortal';
import ClientDashboard from './pages/ClientDashboard';
import AdminDashboard from './pages/AdminDashboard';
import ConfirmAppointment from './pages/ConfirmAppointment';
import Login from './pages/Login';

// Rota protegida super simples para o painel
function PrivateRoute({ children }) {
  const user = sessionStorage.getItem('user');
  return user ? children : <Navigate to="/login" />;
}

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-background flex flex-col">
        <Routes>
          <Route path="/" element={<ClientPortal />} />
          <Route path="/login" element={<Login />} />
          <Route path="/meu-perfil" element={<ClientDashboard />} />
          <Route path="/confirmar/:id" element={<ConfirmAppointment />} />
          <Route 
            path="/admin" 
            element={
              <PrivateRoute>
                <AdminDashboard />
              </PrivateRoute>
            } 
          />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
