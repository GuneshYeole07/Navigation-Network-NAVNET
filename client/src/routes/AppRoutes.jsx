import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import ProtectedRoute from "./ProtectedRoute";
import AppLayout from "../layouts/AppLayout";
import { FullScreenLoader } from "../components/ui/Skeleton";
import Landing from "../pages/Landing";
import Login from "../pages/auth/Login";
import NotFound from "../pages/NotFound";

// Map-heavy screens are code-split so the landing page stays light.
const UserHome = lazy(() => import("../pages/user/UserHome"));
const JoinTrip = lazy(() => import("../pages/user/JoinTrip"));
const TripDashboard = lazy(() => import("../pages/user/TripDashboard"));
const Communities = lazy(() => import("../pages/user/Communities"));
const CommunityDetail = lazy(() => import("../pages/user/CommunityDetail"));
const AdminHome = lazy(() => import("../pages/admin/AdminHome"));
const CreateGroup = lazy(() => import("../pages/admin/CreateGroup"));
const CreateCommunity = lazy(() => import("../pages/admin/CreateCommunity"));
const MonitoringList = lazy(() => import("../pages/admin/MonitoringList"));
const MonitoringPanel = lazy(() => import("../pages/admin/MonitoringPanel"));
const TripReport = lazy(() => import("../pages/TripReport"));
const Profile = lazy(() => import("../pages/Profile"));

export default function AppRoutes() {
  return (
    <Suspense fallback={<FullScreenLoader />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login/:role" element={<Login />} />

        <Route element={<ProtectedRoute role="USER" />}>
          <Route path="/user/trip/:id" element={<TripDashboard />} />
          <Route element={<AppLayout />}>
            <Route path="/user" element={<UserHome />} />
            <Route path="/user/join" element={<JoinTrip />} />
            <Route path="/user/communities" element={<Communities />} />
            <Route path="/user/communities/:id" element={<CommunityDetail />} />
          </Route>
        </Route>

        <Route element={<ProtectedRoute role="ADMIN" />}>
          <Route path="/admin/monitor/:id" element={<MonitoringPanel />} />
          {/* The organiser riding along: same phone ride screen, with captain tools */}
          <Route path="/admin/ride/:id" element={<TripDashboard />} />
          <Route element={<AppLayout />}>
            <Route path="/admin" element={<AdminHome />} />
            <Route path="/admin/create-group" element={<CreateGroup />} />
            <Route path="/admin/create-community" element={<CreateCommunity />} />
            <Route path="/admin/monitor" element={<MonitoringList />} />
          </Route>
        </Route>

        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/trips/:id/report" element={<TripReport />} />
            <Route path="/profile" element={<Profile />} />
          </Route>
        </Route>

        <Route path="/login" element={<Navigate to="/login/user" replace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
