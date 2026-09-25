import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../auth/AuthContext";
import { useDialogFocus } from "../../shared/hooks/useDialogFocus";
import { api } from "../../lib/api";
import { PROFILE_IMAGE_ACCEPT, prepareProfileAvatarDataUrl } from "../lib/profileImage";
import type { User } from "../../types";
import { EyeIcon, MailIcon, TrashIcon, UploadIcon } from "./AppIcons";

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

function ProfileAvatarPreview({
  avatarDataUrl
}: {
  avatarDataUrl?: string | null;
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
      <ProfileCameraIcon />
    </span>
  );
}

function ProfileCameraIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="42" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="42">
      <path d="M8.5 7.5 10 5h4l1.5 2.5H18A2.5 2.5 0 0 1 20.5 10v6A2.5 2.5 0 0 1 18 18.5H6A2.5 2.5 0 0 1 3.5 16v-6A2.5 2.5 0 0 1 6 7.5z" />
      <circle cx="12" cy="13" r="3.25" />
    </svg>
  );
}

function ProfileUserIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="18">
      <circle cx="12" cy="8" r="3.25" />
      <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
    </svg>
  );
}

function ProfileInfoIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="22" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="22">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </svg>
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
      className="modal-backdrop modal-backdrop--scroll profile-dialog-backdrop"
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
        className="modal-card profile-dialog-card"
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <form
          className="profile-dialog-form"
          onSubmit={(event) => {
            event.preventDefault();
            setFeedback(null);
            updateProfile.mutate(draft);
          }}
        >
          <div className="profile-dialog-header">
            <div className="profile-dialog-title">
              <h2 id="profile-dialog-title">Personal Profile</h2>
            </div>
            <button
              aria-label="Close profile dialog"
              className="ghost-button profile-dialog-close-button"
              disabled={isBusy}
              onClick={onClose}
              type="button"
            >
              Close
            </button>
          </div>

          <div className="profile-dialog-body">
            {feedback ? (
              <p className={feedback.tone === "success" ? "inline-message success-message" : "inline-message error-message"}>
                {feedback.message}
              </p>
            ) : null}

            <div className="profile-dialog-layout">
              <section className="profile-dialog-photo-panel" aria-label="Profile photo">
                <ProfileAvatarPreview avatarDataUrl={draft.avatar_data_url} />
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
                    <UploadIcon size={18} strokeWidth={2} />
                    <span>{isPreparingAvatar ? "Processing photo..." : draft.avatar_data_url ? "Change photo" : "Upload photo"}</span>
                  </button>
                  <button
                    className="ghost-button danger"
                    disabled={isBusy}
                    onClick={() => {
                      setDraft((current) => current ? { ...current, avatar_data_url: null } : current);
                      setFeedback(null);
                    }}
                    type="button"
                  >
                    <TrashIcon size={18} strokeWidth={2} />
                    <span>Remove photo</span>
                  </button>
                </div>
                <p className="profile-dialog-avatar-note">
                  Uploaded photos are center-cropped to a square thumbnail, compressed, then stored as embedded image data for the sidebar profile chip.
                </p>
              </section>

              <div className="profile-dialog-main">
                <div className="profile-dialog-identity-grid">
                  <label className="profile-field-card">
                    <input
                      className="profile-field-input"
                      data-autofocus="true"
                      name="name"
                      onChange={(event) => setDraft((current) => current ? { ...current, name: event.target.value } : current)}
                      placeholder="Full Name"
                      value={draft.name}
                    />
                    <span className="profile-field-label">
                      <ProfileUserIcon />
                      <span>Full Name</span>
                    </span>
                  </label>

                  <label className="profile-field-card">
                    <input
                      className="profile-field-input"
                      name="email"
                      onChange={(event) => setDraft((current) => current ? { ...current, email: event.target.value } : current)}
                      placeholder="Email Address"
                      required
                      type="email"
                      value={draft.email}
                    />
                    <span className="profile-field-label">
                      <MailIcon size={18} strokeWidth={2} />
                      <span>Email Address</span>
                    </span>
                  </label>
                </div>

                <div className="profile-dialog-secondary-grid">
                  <div className="profile-dialog-summary">
                    <ProfileInfoIcon />
                    <p>
                      {formatRoleLabel(user.role)} access is managed from the Users page. Use this dialog for your own display details and profile photo.
                    </p>
                    <p>Workspace-wide user and role changes still live under Administration.</p>
                  </div>

                  <section className="profile-password-panel" aria-label="Change password">
                    <strong>Change password</strong>
                    <div className="profile-password-fields">
                      <label className="profile-password-field">
                        <span className="sr-only">Current password</span>
                        <input
                          autoComplete="current-password"
                          disabled={user.auth_provider === "google" || isBusy}
                          name="current_password"
                          onChange={(event) => setPasswordDraft((current) => ({ ...current, current_password: event.target.value }))}
                          placeholder="Current password"
                          type="password"
                          value={passwordDraft.current_password}
                        />
                        <span className="profile-password-eye" aria-hidden="true">
                          <EyeIcon size={18} strokeWidth={2} />
                        </span>
                      </label>
                      <label className="profile-password-field">
                        <span className="sr-only">New password</span>
                        <input
                          autoComplete="new-password"
                          disabled={user.auth_provider === "google" || isBusy}
                          name="new_password"
                          onChange={(event) => setPasswordDraft((current) => ({ ...current, new_password: event.target.value }))}
                          placeholder="New password"
                          type="password"
                          value={passwordDraft.new_password}
                        />
                        <span className="profile-password-eye" aria-hidden="true">
                          <EyeIcon size={18} strokeWidth={2} />
                        </span>
                      </label>
                      <label className="profile-password-field">
                        <span className="sr-only">Confirm password</span>
                        <input
                          autoComplete="new-password"
                          disabled={user.auth_provider === "google" || isBusy}
                          name="confirm_password"
                          onChange={(event) => setPasswordDraft((current) => ({ ...current, confirm_password: event.target.value }))}
                          placeholder="Confirm password"
                          type="password"
                          value={passwordDraft.confirm_password}
                        />
                        <span className="profile-password-eye" aria-hidden="true">
                          <EyeIcon size={18} strokeWidth={2} />
                        </span>
                      </label>
                      <button
                        className="primary-button profile-password-submit"
                        disabled={isBusy || !canChangePassword}
                        onClick={() => {
                          setFeedback(null);
                          changePassword.mutate(passwordDraft);
                        }}
                        type="button"
                      >
                        {changePassword.isPending ? "Changing..." : "Change password"}
                      </button>
                    </div>
                  </section>
                </div>
              </div>
            </div>
          </div>

          <div className="profile-dialog-actions">
            <button className="ghost-button" disabled={isBusy} onClick={onClose} type="button">
              Cancel
            </button>
            <button className="ghost-button profile-save-button" disabled={isBusy || !hasChanges} type="submit">
              {updateProfile.isPending ? "Saving..." : "Save profile"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
