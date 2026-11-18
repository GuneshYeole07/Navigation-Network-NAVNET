import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { Bike, ShieldCheck } from "lucide-react";
import Logo from "../../components/ui/Logo";
import ThemeToggle from "../../components/ui/ThemeToggle";
import Field from "../../components/ui/Field";
import { useAuth } from "../../context/AuthContext";

const SHOW_DEMO = import.meta.env.VITE_SHOW_DEMO !== "false";
const DEMO = {
  admin: { email: "admin@navnet.dev", password: "Admin@123" },
  user: { email: "aarav@navnet.dev", password: "Rider@123" },
};

export default function Login() {
  const { role: roleParam } = useParams();
  const portal = roleParam === "admin" ? "admin" : "user";
  const ROLE = portal === "admin" ? "ADMIN" : "USER";
  const [mode, setMode] = useState("login");
  const { user, login, register: signup } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const {
    register,
    handleSubmit,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm();

  // Where to go after signing in: back to the page that sent them here (e.g. an invite
  // link, query string included), if it belongs to this role; otherwise their home.
  const homeFor = (role) => (role === "ADMIN" ? "/admin" : "/user");
  const destFor = (role) => {
    const from = location.state?.from;
    const dest = from ? `${from.pathname}${from.search || ""}` : null;
    return dest && dest.startsWith(homeFor(role)) ? dest : homeFor(role);
  };

  // Also covers the moment right after sign-in, when this re-renders with the new user
  // before onSubmit's navigate() — both must agree on the destination.
  if (user) return <Navigate to={destFor(user.role)} replace />;

  const onSubmit = async (values) => {
    try {
      const u =
        mode === "login"
          ? await login({ email: values.email, password: values.password, role: ROLE })
          : await signup({ ...values, role: ROLE });
      toast.success(mode === "login" ? `Welcome back, ${u.name.split(" ")[0]}` : "Account created");
      navigate(destFor(u.role), { replace: true });
    } catch (e) {
      e.details?.forEach((d) => d.field && setError(d.field, { message: d.message }));
      toast.error(e.message);
    }
  };

  const Icon = portal === "admin" ? ShieldCheck : Bike;

  return (
    <div className="flex min-h-full flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-12 pt-4 sm:items-center">
        <div className="w-full max-w-md">
          <div className="mb-6 flex items-center gap-3">
            <span className={`grid h-12 w-12 place-items-center rounded-control ${portal === "admin" ? "bg-asphalt text-white dark:bg-road dark:text-asphalt" : "bg-nh text-white"}`}>
              <Icon size={24} aria-hidden="true" />
            </span>
            <div>
              <h1 className="text-4xl leading-none">{portal === "admin" ? "Admin" : "Rider"} {mode === "login" ? "sign in" : "sign up"}</h1>
              <p className="mt-1 text-sm muted">
                {portal === "admin" ? "Create trips, run the convoy and respond to SOS." : "Join your group's trip and ride together."}
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="panel space-y-4 p-6" noValidate>
            {mode === "register" && (
              <Field label="Full name" autoComplete="name" error={errors.name?.message} {...register("name", { required: "Enter your name", minLength: { value: 2, message: "Name is too short" } })} />
            )}
            <Field
              label="Email"
              type="email"
              autoComplete="email"
              error={errors.email?.message}
              {...register("email", { required: "Enter your email", pattern: { value: /\S+@\S+\.\S+/, message: "Enter a valid email" } })}
            />
            <Field
              label="Password"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              error={errors.password?.message}
              hint={mode === "register" ? "At least 8 characters, with a letter and a number." : undefined}
              {...register("password", {
                required: "Enter your password",
                ...(mode === "register" && {
                  minLength: { value: 8, message: "At least 8 characters" },
                  validate: (v) => (/[A-Za-z]/.test(v) && /\d/.test(v)) || "Include a letter and a number",
                }),
              })}
            />
            {mode === "register" && (
              <Field
                label={portal === "admin" ? "Phone number" : "Phone number (optional)"}
                type="tel"
                autoComplete="tel"
                placeholder="98765 43210"
                hint={portal === "admin" ? "Riders can call or SMS you from the SOS screen, even with no data." : "Lets your trip admin call you in an emergency. Only the admin sees it."}
                error={errors.phone?.message}
                {...register("phone", {
                  ...(portal === "admin" && { required: "Admins need a phone number so riders can reach you in an emergency" }),
                  pattern: { value: /^\+?[0-9 ()-]{7,20}$/, message: "Enter a valid phone number" },
                })}
              />
            )}
            {mode === "register" && portal === "user" && (
              <Field label="Vehicle number (optional)" placeholder="MH12 AB 1234" error={errors.vehicleNumber?.message} {...register("vehicleNumber")} />
            )}
            {mode === "register" && portal === "admin" && (
              <Field
                label="Admin invite code"
                hint="Ask the NavNet operator for this code. It's set as ADMIN_SIGNUP_CODE on the server."
                error={errors.adminCode?.message}
                {...register("adminCode", { required: "An invite code is required for admin accounts" })}
              />
            )}
            <button type="submit" className="btn-primary w-full !py-3" disabled={isSubmitting}>
              {isSubmitting ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
            </button>

            {SHOW_DEMO && mode === "login" && (
              <button
                type="button"
                className="w-full text-center text-sm font-medium text-nh hover:underline"
                onClick={() => {
                  setValue("email", DEMO[portal].email);
                  setValue("password", DEMO[portal].password);
                }}
              >
                Fill in the demo {portal === "admin" ? "admin" : "rider"} account
              </button>
            )}
          </form>

          <p className="mt-5 text-center text-sm muted">
            {mode === "login" ? "New to NavNet? " : "Already have an account? "}
            <button className="font-semibold text-nh hover:underline" onClick={() => setMode(mode === "login" ? "register" : "login")}>
              {mode === "login" ? "Create an account" : "Sign in"}
            </button>
          </p>
          <p className="mt-2 text-center text-sm muted">
            {portal === "admin" ? "Riding, not organising? " : "Organising the trip? "}
            <Link to={`/login/${portal === "admin" ? "user" : "admin"}`} className="font-semibold text-nh hover:underline">
              {portal === "admin" ? "Login as User" : "Login as Admin"}
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
