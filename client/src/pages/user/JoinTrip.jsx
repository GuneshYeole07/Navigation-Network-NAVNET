import { useEffect, useRef, useState } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { ChevronLeft } from "lucide-react";
import Field from "../../components/ui/Field";
import { FullScreenLoader } from "../../components/ui/Skeleton";
import { tripService } from "../../services/tripService";
import { useAuth } from "../../context/AuthContext";

export default function JoinTrip() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const invite = params.get("invite");
  const [inviteState, setInviteState] = useState(invite ? "joining" : null);
  const tried = useRef(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ defaultValues: { vehicleNumber: user?.vehicleNumber || "", groupCode: params.get("code") || "" } });

  // Invite link / QR: join automatically, no typing.
  useEffect(() => {
    if (!invite || tried.current) return;
    tried.current = true;
    tripService
      .join({ invite })
      .then((r) => {
        toast.success(`You're in: ${r.name}`);
        navigate(`/user/trip/${r.tripId}`, { replace: true });
      })
      .catch((e) => {
        toast.error(e.message);
        setInviteState("failed");
      });
  }, [invite, navigate]);

  const onSubmit = async (v) => {
    try {
      const r = await tripService.join({ ...v, groupCode: v.groupCode.trim().toUpperCase() });
      toast.success(`You're in: ${r.name}`);
      navigate(`/user/trip/${r.tripId}`);
    } catch (e) {
      toast.error(e.message);
    }
  };

  if (inviteState === "joining") return <FullScreenLoader label="Joining the trip" />;

  return (
    <div className="mx-auto max-w-md">
      <Link to="/user" className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-nh">
        <ChevronLeft size={16} /> Back
      </Link>
      <h1 className="text-5xl leading-none">Join a trip</h1>
      <p className="mt-2 muted">
        {inviteState === "failed"
          ? "That invite link didn't work. Enter the Group ID and password instead, or ask the admin for a new link."
          : "Got an invite link? Just tap it. Otherwise enter the Group ID and password from your trip admin."}
      </p>
      <form onSubmit={handleSubmit(onSubmit)} className="panel mt-6 space-y-4 p-6" noValidate>
        <Field
          label="Group ID"
          placeholder="PUNE-RIDE"
          autoCapitalize="characters"
          className="[&_input]:font-display [&_input]:text-xl [&_input]:tracking-wider"
          error={errors.groupCode?.message}
          {...register("groupCode", { required: "Enter the Group ID" })}
        />
        <Field label="Group password" type="password" autoComplete="off" error={errors.password?.message} {...register("password", { required: "Enter the group password" })} />
        <Field label="Vehicle number (optional)" placeholder="MH12 AB 1234" hint="Helps the admin identify you on the road." {...register("vehicleNumber")} />
        <button className="btn-primary w-full !py-3" disabled={isSubmitting}>
          {isSubmitting ? "Checking…" : "Join trip"}
        </button>
      </form>
    </div>
  );
}
