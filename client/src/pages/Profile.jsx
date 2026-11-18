import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { ChevronLeft, HeartPulse } from "lucide-react";
import Field from "../components/ui/Field";
import { authService } from "../services/authService";
import { useAuth } from "../context/AuthContext";

const BLOOD = ["", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

/** Profile + emergency card. The card is shown only to the ride captain, and travels with your SOS. */
export default function Profile() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    defaultValues: {
      name: user.name,
      phone: user.phone || "",
      vehicleNumber: user.vehicleNumber || "",
      bloodGroup: user.bloodGroup || "",
      emergencyName: user.emergencyName || "",
      emergencyPhone: user.emergencyPhone || "",
      medicalNotes: user.medicalNotes || "",
    },
  });

  const onSubmit = async (v) => {
    try {
      const { user: u } = await authService.updateMe(v);
      setUser(u);
      toast.success("Profile saved");
      navigate(-1);
    } catch (e) {
      e.details?.forEach((d) => d.field && setError(d.field, { message: d.message }));
      toast.error(e.message);
    }
  };
  const phone = { pattern: { value: /^\+?[0-9 ()-]{7,20}$/, message: "Enter a valid phone number" } };

  return (
    <div className="mx-auto max-w-lg">
      <button onClick={() => navigate(-1)} className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-nh">
        <ChevronLeft size={16} /> Back
      </button>
      <h1 className="text-5xl leading-none">Your profile</h1>
      <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-6" noValidate>
        <section className="panel space-y-4 p-5">
          <Field label="Name" error={errors.name?.message} {...register("name", { required: "Enter your name" })} />
          <Field label="Phone number" type="tel" placeholder="98765 43210" hint="Your trip admin can call you in an emergency." error={errors.phone?.message} {...register("phone", phone)} />
          <Field label="Vehicle number" placeholder="MH12 AB 1234" {...register("vehicleNumber")} />
        </section>

        <section className="panel space-y-4 border-l-4 border-signal p-5">
          <div className="flex items-start gap-3">
            <HeartPulse className="mt-1 shrink-0 text-signal" />
            <div>
              <h2 className="text-2xl leading-tight">Emergency card</h2>
              <p className="text-sm muted">If you press SOS, this goes to your ride captain instantly. Nobody else in the group sees it.</p>
            </div>
          </div>
          <Field as="select" label="Blood group" error={errors.bloodGroup?.message} {...register("bloodGroup")}>
            {BLOOD.map((b) => (
              <option key={b} value={b}>
                {b || "Not set"}
              </option>
            ))}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Emergency contact name" placeholder="Mom / spouse / friend" {...register("emergencyName")} />
            <Field label="Emergency contact phone" type="tel" placeholder="98765 43210" error={errors.emergencyPhone?.message} {...register("emergencyPhone", phone)} />
          </div>
          <Field as="textarea" label="Medical notes (optional)" placeholder="Allergies, conditions, medication a first-aider should know" maxLength={300} {...register("medicalNotes")} />
        </section>

        <button className="btn-primary w-full !py-3" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : "Save profile"}
        </button>
      </form>
    </div>
  );
}
