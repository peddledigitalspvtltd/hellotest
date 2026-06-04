import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { api } from "../lib/api";
import { PROFILE_IMAGE_ACCEPT, prepareProfileAvatarDataUrl } from "../lib/profileImage";
import type { User } from "../types";
import { FormField } from "./FormField";

type ProfileFeedback = {
  message: string;
  tone: "success" | "error";
};

type ProfileDraft = {
  name: string;
  email: string;
  avatar_data_url: string | null;
};

type PasswordDraft = {
  current_password: string;
  new_password: string;
  confirm_password: string;
};

const toDraft = (user: User): ProfileDraft => ({
  name: user.name || "",
  email: user.email,
  avatar_data_url: user.avatar_data_url || null
});

const formatRoleLabel = (role?: string) => (role === "admin" ? "Admin" : "Member");
const formatProviderLabel = (provider?: string) => (provider === "google" ? "Google Sign-In" : "Local account");

const getAvatarFallback = (name: string, email: string) => {
  const source = (name || email || "WU").trim();
  const tokens = source.split(/\s+/).filter(Boolean);

  if (tokens.length >= 2) {
    return `${tokens[0][0]}${tokens[1][0]}`.toUpperCase();
  }

  return source.slice(0, 2).toUpperCase();
};

function ProfileAvatarPreview({
  avatarDataUrl,
  email,
  name
}: {
  avatarDataUrl?: string | null;
  email: string;
  name: string;
}) {
  if (avatarDataUrl) {
    return (
      <span className="profile-avatar profile-avatar--has-image" aria-hidden="true">
        <img alt="" src={avatarDataUrl} />
      </span>
    );
  }

  return (
    <span className="profile-avatar" aria-hidden="true">
      <span>{getAvatarFallback(name, email)}</span>
    </span>
  );
}

export function UserProfileDialog({
  isOpen,
  onClose
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { session, refreshSession } = useAuth();
  const queryClient = useQueryClient();
  const dialogRef = useDialogFocus<HTMLDivElement>();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [passwordDraft, setPasswordDraft] = useState<PasswordDraft>({
    current_password: "",
    new_password: "",
    confirm_password: ""
  });
  const [feedback, setFeedback] = useState<ProfileFeedback | null>(null);
  const [isPreparingAvatar, setIsPreparingAvatar] = useState(false);

  const user = session?.user || null;

  useEffect(() => {
    if (!isOpen || !user) {
      return;
    }

    setDraft(toDraft(user));
    setPasswordDraft({ current_password: "", new_password: "", confirm_password: "" });
    setFeedback(null);
    setIsPreparingAvatar(false);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [isOpen, user]);

  const updateProfile = useMutation({
    mutationFn: async (input: ProfileDraft) => {
      if (!user) {
        throw new Error("You must be signed in to update your profile.");
      }

      return api.users.update(user.id, {
        name: input.name.trim(),
        email: input.email.trim(),
        avatar_data_url: input.avatar_data_url
      });
    },
    onSuccess: async () => {
      await Promise.all([
        refreshSession(),
        queryClient.invalidateQueries({ queryKey: ["users"] })
      ]);
      onClose();
    },
    onError: (error) => {
      setFeedback({
        message: error instanceof Error ? error.message : "Unable to update your profile.",
        tone: "error"
      });
    }
  });

  const changePassword = useMutation({
    mutationFn: async (input: PasswordDraft) => {
      if (!user) {
        throw new Error("You must be signed in to change your password.");
      }

      if (input.new_password !== input.confirm_password) {
        throw new Error("New password and confirmation do not match.");
      }

      return api.users.changePassword(user.id, {
        current_password: input.current_password,
        new_password: input.new_password
      });
    },
    onSuccess: () => {
      setPasswordDraft({ current_password: "", new_password: "", confirm_password: "" });
      setFeedback({
        message: "Password changed successfully.",
        tone: "success"
      });
    },
    onError: (error) => {
      setFeedback({
        message: error instanceof Error ? error.message : "Unable to change password.",
        tone: "error"
      });
    }
  });

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !updateProfile.isPending && !changePassword.isPending && !isPreparingAvatar) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [changePassword.isPending, isOpen, isPreparingAvatar, onClose, updateProfile.isPending]);

  const hasChanges = useMemo(() => {
    if (!user || !draft) {
      return false;
    }

    return (
      draft.name !== (user.name || "")
      || draft.email !== user.email
      || draft.avatar_data_url !== (user.avatar_data_url || null)
    );
  }, [draft, user]);

  if (!isOpen || !user || !draft) {
    return null;
  }

  const isBusy = updateProfile.isPending || changePassword.isPending || isPreparingAvatar;
  const hasPasswordDraft = Boolean(passwordDraft.current_password || passwordDraft.new_password || passwordDraft.confirm_password);
  const canChangePassword =
    user.auth_provider !== "google"
    && passwordDraft.current_password.length > 0
    && passwordDraft.new_password.length >= 6
    && passwordDraft.new_password === passwordDraft.confirm_password;

  const handleAvatarChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setIsPreparingAvatar(true);
    setFeedback(null);

    try {
      const avatarDataUrl = await prepareProfileAvatarDataUrl(file);

      setDraft((current) => current ? { ...current, avatar_data_url: avatarDataUrl } : current);
      setFeedback({
        message: "Profile photo is ready. Save your profile to apply it.",
        tone: "success"
      });
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "Unable to prepare the selected image.",
        tone: "error"
      });
    } finally {
      setIsPreparingAvatar(false);

      if (event.target) {
        event.target.value = "";
      }
    }
  };

  return (
    <div
      className="modal-backdrop modal-backdrop--scroll"
      onClick={() => {
        if (!isBusy) {
          onClose();
        }
      }}
      role="presentation"
    >
      <div
        aria-labelledby="profile-dialog-title"
        aria-modal="true"
        className="modal-card people-modal-card profile-dialog-card"
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <form
          className="people-modal-form profile-dialog-form"
          onSubmit={(event) => {
            event.preventDefault();
            setFeedback(null);
            updateProfile.mutate(draft);
          }}
        >
          <div className="people-modal-header profile-dialog-header">
            <div className="people-modal-title">
              <p>Personal profile</p>
              <p className="eyebrow" id="profile-dialog-title">Update your sidebar profile</p>
            </div>
            <button
              aria-label="Close profile dialog"
              className="ghost-button"
              disabled={isBusy}
              onClick={onClose}
              type="button"
            >
              Close
            </button>
          </div>

          <div className="people-modal-body profile-dialog-body">
            {feedback ? (
              <p className={feedback.tone === "success" ? "inline-message success-message" : "inline-message error-message"}>
                {feedback.message}
              </p>
            ) : null}

            <section className="profile-dialog-hero" aria-label="Profile summary">
              <ProfileAvatarPreview avatarDataUrl={draft.avatar_data_url} email={draft.email} name={draft.name || user.name || user.email} />

              <div className="profile-dialog-copy">
                <strong>{draft.name || user.name || "Workspace user"}</strong>
                <span>{draft.email}</span>
                <div className="profile-dialog-meta">
                  <span>{formatRoleLabel(user.role)} access</span>
                  <span>{formatProviderLabel(user.auth_provider)}</span>
                </div>
                <div className="action-row profile-dialog-photo-actions">
                  <input
                    accept={PROFILE_IMAGE_ACCEPT}
                    className="profile-dialog-file-input"
                    onChange={handleAvatarChange}
                    ref={fileInputRef}
                    type="file"
                  />
                  <button
                    className="ghost-button"
                    disabled={isBusy}
                    onClick={() => fileInputRef.current?.click()}
                    type="button"
                  >
                    {isPreparingAvatar ? "Processing photo…" : draft.avatar_data_url ? "Change photo" : "Upload photo"}
                  </button>
                  <button
                    className="ghost-button danger"
                    disabled={isBusy || !draft.avatar_data_url}
                    onClick={() => {
                      setDraft((current) => current ? { ...current, avatar_data_url: null } : current);
                      setFeedback(null);
                    }}
                    type="button"
                  >
                    Remove photo
                  </button>
                </div>
                <p className="profile-dialog-avatar-note">
                  Uploaded photos are center-cropped to a square thumbnail, compressed, then stored as embedded image data for the sidebar profile chip.
                </p>
              </div>
            </section>

            <div className="profile-dialog-grid">
              <FormField label="Name">
                <input
                  data-autofocus="true"
                  name="name"
                  onChange={(event) => setDraft((current) => current ? { ...current, name: event.target.value } : current)}
                  placeholder="Your display name"
                  value={draft.name}
                />
              </FormField>

              <FormField label="Email">
                <input
                  name="email"
                  onChange={(event) => setDraft((current) => current ? { ...current, email: event.target.value } : current)}
                  placeholder="you@company.com"
                  required
                  type="email"
                  value={draft.email}
                />
              </FormField>
            </div>

            <div className="detail-summary compact-summary profile-dialog-summary">
              <strong>{formatRoleLabel(user.role)} access is managed from the Users page</strong>
              <span>Use this dialog for your own display details and profile photo. Workspace-wide user and role changes still live under Administration.</span>
            </div>

            <section className="profile-password-panel" aria-label="Change password">
              <div className="profile-password-panel-head">
                <div>
                  <strong>Change password</strong>
                  <span>{user.auth_provider === "google" ? "Managed by Google Sign-In" : "Update your local sign-in password"}</span>
                </div>
              </div>
              <div className="profile-dialog-grid">
                <FormField label="Current password">
                  <input
                    autoComplete="current-password"
                    disabled={user.auth_provider === "google" || isBusy}
                    name="current_password"
                    onChange={(event) => setPasswordDraft((current) => ({ ...current, current_password: event.target.value }))}
                    type="password"
                    value={passwordDraft.current_password}
                  />
                </FormField>
                <FormField label="New password">
                  <input
                    autoComplete="new-password"
                    disabled={user.auth_provider === "google" || isBusy}
                    name="new_password"
                    onChange={(event) => setPasswordDraft((current) => ({ ...current, new_password: event.target.value }))}
                    type="password"
                    value={passwordDraft.new_password}
                  />
                </FormField>
                <FormField label="Confirm password">
                  <input
                    autoComplete="new-password"
                    disabled={user.auth_provider === "google" || isBusy}
                    name="confirm_password"
                    onChange={(event) => setPasswordDraft((current) => ({ ...current, confirm_password: event.target.value }))}
                    type="password"
                    value={passwordDraft.confirm_password}
                  />
                </FormField>
                <div className="profile-password-action">
                  <button
                    className="ghost-button"
                    disabled={isBusy || !hasPasswordDraft}
                    onClick={() => {
                      setPasswordDraft({ current_password: "", new_password: "", confirm_password: "" });
                      setFeedback(null);
                    }}
                    type="button"
                  >
                    Clear
                  </button>
                  <button
                    className="primary-button"
                    disabled={isBusy || !canChangePassword}
                    onClick={() => {
                      setFeedback(null);
                      changePassword.mutate(passwordDraft);
                    }}
                    type="button"
                  >
                    {changePassword.isPending ? "Changing…" : "Change password"}
                  </button>
                </div>
              </div>
            </section>
          </div>

          <div className="action-row people-modal-actions">
            <button className="ghost-button" disabled={isBusy} onClick={onClose} type="button">
              Cancel
            </button>
            <button className="primary-button" disabled={isBusy || !hasChanges} type="submit">
              {updateProfile.isPending ? "Saving…" : "Save profile"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
