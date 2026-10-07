import { useId, type CSSProperties, type ReactNode } from "react";
import {
  IconChevronDown,
  IconChevronRight,
  IconCheckbox,
  IconDatabase,
  IconFileDescription,
  IconFlask2,
  IconFolderOff,
  IconLink,
  IconRocket,
  IconTag
} from "@tabler/icons-react";
import backlogIcon from "../../assets/backlog-icon.png";
import releaseNotesIcon from "../../assets/release-notes-icon.png";
import testSuiteIcon from "../../assets/test-suite-icon.png";
import moduleIcon from "../../assets/module-icon.png";
import aiAgentsIcon from "../../assets/ai-agents-icon.png";

type IconProps = {
  size?: number;
  strokeWidth?: number;
};

function AssetMaskIcon({ source, size = 16 }: { source: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        backgroundColor: "currentColor",
        display: "inline-block",
        flex: "0 0 auto",
        height: size,
        maskImage: `url(${source})`,
        maskPosition: "center",
        maskRepeat: "no-repeat",
        maskSize: "contain",
        WebkitMaskImage: `url(${source})`,
        WebkitMaskPosition: "center",
        WebkitMaskRepeat: "no-repeat",
        WebkitMaskSize: "contain",
        width: size
      }}
    />
  );
}

export function TestSuiteIcon({ size = 16 }: IconProps) {
  return <AssetMaskIcon size={size} source={testSuiteIcon} />;
}

export function ModuleIcon({ size = 16 }: IconProps) {
  return <AssetMaskIcon size={size} source={moduleIcon} />;
}

export function AiAgentsIcon({ size = 18 }: IconProps) {
  return <img alt="" aria-hidden="true" height={size} src={aiAgentsIcon} style={{ display: "inline-block", flex: "0 0 auto", objectFit: "contain" }} width={size} />;
}

function IconFrame({
  children,
  size = 16,
  strokeWidth = 1.9,
  viewBox = "0 0 24 24"
}: {
  children: ReactNode;
  size?: number;
  strokeWidth?: number;
  viewBox?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      viewBox={viewBox}
      width={size}
    >
      {children}
    </svg>
  );
}

function ProductIconFrame({
  children,
  size = 16
}: {
  children: ReactNode;
  size?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      fill="currentColor"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      {children}
    </svg>
  );
}

/** Compact explorer actions based on the open-source VS Code Codicon shapes. */
export function CollapseExpandIcon({ isExpanded, size }: IconProps & { isExpanded: boolean }) {
  return (
    <ProductIconFrame size={size}>
      {isExpanded ? (
        <>
          <path d="M14 4.27051C14.5999 4.62053 15 5.26009 15 6V11C15 13.21 13.21 15 11 15H6C5.26009 15 4.62053 14.5999 4.27051 14H11C12.65 14 14 12.65 14 11V4.27051Z" />
          <path d="M9.5 7C9.776 7 10 7.224 10 7.5C10 7.776 9.776 8 9.5 8H5.5C5.224 8 5 7.776 5 7.5C5 7.224 5.224 7 5.5 7H9.5Z" />
          <path clipRule="evenodd" d="M11 2C12.103 2 13 2.897 13 4V11C13 12.103 12.103 13 11 13H4C2.897 13 2 12.103 2 11V4C2 2.897 2.897 2 4 2H11ZM4 3C3.449 3 3 3.449 3 4V11C3 11.552 3.449 12 4 12H11C11.551 12 12 11.552 12 11V4C12 3.449 11.551 3 11 3H4Z" fillRule="evenodd" />
        </>
      ) : (
        <path d="M15 6V11C15 13.21 13.21 15 11 15H6C5.26 15 4.62 14.6 4.27 14H11C12.65 14 14 12.65 14 11V4.27C14.6 4.62 15 5.26 15 6ZM11 13H4C2.897 13 2 12.103 2 11V4C2 2.897 2.897 2 4 2H11C12.103 2 13 2.897 13 4V11C13 12.103 12.103 13 11 13ZM4 12H11C11.551 12 12 11.552 12 11V4C12 3.449 11.551 3 11 3H4C3.449 3 3 3.449 3 4V11C3 11.552 3.449 12 4 12ZM9.5 7H8V5.5C8 5.224 7.776 5 7.5 5C7.224 5 7 5.224 7 5.5V7H5.5C5.224 7 5 7.224 5 7.5C5 7.776 5.224 8 5.5 8H7V9.5C7 9.776 7.224 10 7.5 10C7.776 10 8 9.776 8 9.5V8H9.5C9.776 8 10 7.776 10 7.5C10 7.224 9.776 7 9.5 7Z" />
      )}
    </ProductIconFrame>
  );
}

export function FolderAddIcon({ size }: IconProps) {
  return (
    <ProductIconFrame size={size}>
      <path d="M2 4.5V6H5.58579C5.71839 6 5.84557 5.94732 5.93934 5.85355L7.29289 4.5L5.93934 3.14645C5.84557 3.05268 5.71839 3 5.58579 3H3.5C2.67157 3 2 3.67157 2 4.5ZM1 4.5C1 3.11929 2.11929 2 3.5 2H5.58579C5.98361 2 6.36514 2.15804 6.64645 2.43934L8.20711 4H12.5C13.8807 4 15 5.11929 15 6.5V7.25716C14.6929 7.00353 14.3578 6.78261 14 6.59971V6.5C14 5.67157 13.3284 5 12.5 5H8.20711L6.64645 6.56066C6.36514 6.84197 5.98361 7 5.58579 7H2V11.5C2 12.3284 2.67157 13 3.5 13H6.20703C6.30564 13.3486 6.43777 13.6832 6.59971 14H3.5C2.11929 14 1 12.8807 1 11.5V4.5ZM16 11.5C16 13.9853 13.9853 16 11.5 16C9.01472 16 7 13.9853 7 11.5C7 9.01472 9.01472 7 11.5 7C13.9853 7 16 9.01472 16 11.5ZM12 9C12 8.72386 11.7761 8.5 11.5 8.5C11.2239 8.5 11 8.72386 11 9V11H9C8.72386 11 8.5 11.2239 8.5 11.5C8.5 11.7761 8.72386 12 9 12H11V14C11 14.2761 11.2239 14.5 11.5 14.5C11.7761 14.5 12 14.2761 12 14V12H14C14.2761 12 14.5 11.7761 14.5 11.5C14.5 11.2239 14.2761 11 14 11H12V9Z" />
    </ProductIconFrame>
  );
}

export function FileAddIcon({ size }: IconProps) {
  return (
    <ProductIconFrame size={size}>
      <path d="M5 14C4.448 14 4 13.552 4 13V3C4 2.448 4.448 2 5 2H8V4.5C8 5.328 8.672 6 9.5 6H12V6.025C12.344 6.056 12.677 6.121 13 6.213V5.414C13 5.016 12.842 4.635 12.561 4.353L9.647 1.439C9.366 1.158 8.984 1 8.586 1H5C3.895 1 3 1.895 3 3V13C3 14.105 3.895 15 5 15H7.261C7.008 14.693 6.791 14.357 6.607 14H5ZM9 2.207L11.793 5H9.5C9.224 5 9 4.776 9 4.5V2.207ZM11.5 7C9.015 7 7 9.015 7 11.5C7 13.985 9.015 16 11.5 16C13.985 16 16 13.985 16 11.5C16 9.015 13.985 7 11.5 7ZM14 12H12V14C12 14.276 11.776 14.5 11.5 14.5C11.224 14.5 11 14.276 11 14V12H9C8.724 12 8.5 11.776 8.5 11.5C8.5 11.224 8.724 11 9 11H11V9C11 8.724 11.224 8.5 11.5 8.5C11.776 8.5 12 8.724 12 9V11H14C14.276 11 14.5 11.224 14.5 11.5C14.5 11.776 14.276 12 14 12Z" />
    </ProductIconFrame>
  );
}

export function StoryIcon({ size }: IconProps) {
  return (
    <ProductIconFrame size={size}>
      <path d="M11.518 3a.5.5 0 0 0-.5-.5H4.983a.5.5 0 0 0-.5.5v9.806L8 10.333l.431.304 3.087 2.169zm1.5 11.202a.776.776 0 0 1-1.122.694l-.099-.06L8 12.166l-3.796 2.67a.775.775 0 0 1-1.22-.634V3a2 2 0 0 1 2-2h6.035a2 2 0 0 1 2 2z" />
    </ProductIconFrame>
  );
}

/** Exact gear-with-dual-workflow-arrows artwork requested for Backlog. */
export function BacklogIcon({ size = 20 }: IconProps) {
  const style = {
    "--backlog-entity-icon-image": `url("${backlogIcon}")`,
    "--backlog-entity-icon-size": `${size}px`
  } as CSSProperties;

  return <span aria-hidden="true" className="backlog-entity-icon" style={style} />;
}

/** Shared document-and-lab identity for Test Cases at peer-safe catalog sizes. */
export function TestCaseIcon({ size = 16, strokeWidth = 1.9 }: IconProps) {
  const style = {
    "--test-case-entity-icon-size": `${size}px`
  } as CSSProperties;

  return (
    <span aria-hidden="true" className="test-case-entity-icon" style={style}>
      <IconFileDescription
        className="test-case-entity-icon__file"
        size={size}
        stroke={strokeWidth}
      />
      <IconFlask2
        className="test-case-entity-icon__lab"
        size={Math.max(8, Math.round(size * 0.62))}
        stroke={Math.max(2, strokeWidth)}
      />
    </span>
  );
}

/** Shared database identity for reusable test data across navigation, catalogs, and dialogs. */
export function TestDataIcon({ size = 16, strokeWidth = 1.9 }: IconProps) {
  return <IconDatabase aria-hidden="true" size={size} stroke={strokeWidth} />;
}

export function FolderOffIcon({ size = 16, strokeWidth = 1.9 }: IconProps) {
  return <IconFolderOff aria-hidden="true" size={size} stroke={strokeWidth} />;
}

export function ChevronRightIcon({ size = 16, strokeWidth = 1.9 }: IconProps) {
  return <IconChevronRight aria-hidden="true" size={size} stroke={strokeWidth} />;
}

export function ChevronDownIcon({ size = 16, strokeWidth = 1.9 }: IconProps) {
  return <IconChevronDown aria-hidden="true" size={size} stroke={strokeWidth} />;
}

export function LinkIcon({ size = 16, strokeWidth = 1.9 }: IconProps) {
  return <IconLink aria-hidden="true" size={size} stroke={strokeWidth} />;
}

export function TagIcon({ size = 16, strokeWidth = 1.9 }: IconProps) {
  return <IconTag aria-hidden="true" size={size} stroke={strokeWidth} />;
}

export function RefreshIcon({ size }: IconProps) {
  return (
    <ProductIconFrame size={size}>
      <path d="M3 8C3 5.23858 5.23858 3 8 3C9.63527 3 11.0878 3.78495 12.0005 5H10C9.72386 5 9.5 5.22386 9.5 5.5C9.5 5.77614 9.72386 6 10 6H12.8904C12.8973 6.00014 12.9041 6.00014 12.911 6H13C13.2761 6 13.5 5.77614 13.5 5.5V2.5C13.5 2.22386 13.2761 2 13 2C12.7239 2 12.5 2.22386 12.5 2.5V4.03138C11.4009 2.78613 9.79253 2 8 2C4.68629 2 2 4.68629 2 8C2 11.3137 4.68629 14 8 14C11.1301 14 13.6999 11.6035 13.9756 8.54488C14.0003 8.26985 13.7975 8.0268 13.5225 8.00202C13.2474 7.97723 13.0044 8.1801 12.9796 8.45512C12.75 11.003 10.6079 13 8 13C5.23858 13 3 10.7614 3 8Z" />
    </ProductIconFrame>
  );
}

export function AddIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </IconFrame>
  );
}

/** One selection language everywhere: checked selects, the same empty mark clears. */
export function SelectionToggleIcon({ checked, size = 18, strokeWidth = 1.9 }: IconProps & { checked: boolean }) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <path d="M6.5 5H5.75A2.75 2.75 0 0 0 3 7.75v9.5A2.75 2.75 0 0 0 5.75 20h9.5A2.75 2.75 0 0 0 18 17.25v-.75" opacity="0.55" />
      <rect height="14" rx="2.75" width="14" x="6" y="4" />
      {checked ? <path d="m9.25 10.8 2.35 2.4 5.2-5.35" strokeWidth="2.35" /> : null}
    </IconFrame>
  );
}

export function SaveIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <path d="M5 4h11l3 3v13H5z" />
      <path d="M8 4v6h8V4" />
      <path d="M9 20v-6h6v6" />
    </IconFrame>
  );
}

export function UploadIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M5 20h14" />
    </IconFrame>
  );
}

export function ImportIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <path d="M12 4v12" />
      <path d="m7 11 5 5 5-5" />
      <path d="M5 20h14" />
    </IconFrame>
  );
}

export function SparkIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <path d="m12 3 1.9 4.9L19 10l-5.1 2.1L12 17l-1.9-4.9L5 10l5.1-2.1L12 3Z" />
    </IconFrame>
  );
}

export function SearchIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <circle cx="11" cy="11" r="6" />
      <path d="m16 16 4 4" />
    </IconFrame>
  );
}

export function FolderIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v8A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z" />
    </IconFrame>
  );
}

export function SprintIcon({ size = 16 }: IconProps) {
  return (
    <ProductIconFrame size={size}>
      <path
        clipRule="evenodd"
        d="M8 1.5A4.75 4.75 0 0 0 8 11h5.44l-2.22-2.22 1.06-1.06 3.5 3.5a.75.75 0 0 1 0 1.06l-3.5 3.5-1.06-1.06 2.22-2.22H0V11h3.938A6.25 6.25 0 1 1 14.25 6.25h-1.5A4.75 4.75 0 0 0 8 1.5"
        fillRule="evenodd"
      />
    </ProductIconFrame>
  );
}

/** Product release identity, redrawn as a compact rocket from the supplied artwork. */
export function ReleaseIcon({ size = 16, strokeWidth = 1.8 }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <path d="M8.1 15.9c-1.65-.08-3.05.38-4.25 1.38.12-1.7.66-3.12 1.62-4.28" />
      <path d="M8.05 15.95C9.1 10.55 13.2 5.15 20.6 2.85c-.42 7.72-5.38 12.12-10.58 13.5z" />
      <circle cx="15" cy="8.3" r="2.25" />
      <path d="M10.1 16.35c.05 1.7.55 3.12 1.48 4.3 1.26-1.2 1.94-2.62 2.05-4.25" />
      <path d="m6.15 17.8-2.8 2.8" />
      <path d="m8.05 19.15-1.25 2" />
      <path d="m4.8 15.85-2.05 1.25" />
    </IconFrame>
  );
}

/** Exact document-and-rocket Release Notes artwork supplied for the release ribbon. */
export function ReleaseNotesIcon({ size = 16 }: IconProps) {
  return (
    <img
      alt=""
      aria-hidden="true"
      className="release-notes-icon"
      draggable={false}
      height={size}
      src={releaseNotesIcon}
      width={size}
    />
  );
}

/** A clearly visible release launch with one compact readiness check below. */
export function ReleaseReadinessIcon({ size = 18, strokeWidth = 1.9 }: IconProps) {
  const style = {
    "--release-readiness-icon-size": `${size}px`,
    "--release-readiness-icon-width": `${Math.round(size * 1.15)}px`
  } as CSSProperties;
  const checkSize = Math.max(3, Math.round(size * 0.15));
  const rocketSize = Math.max(15, Math.round(size * 0.82));

  return (
    <span aria-hidden="true" className="release-readiness-icon" style={style}>
      <IconRocket className="release-readiness-icon__rocket" size={rocketSize} stroke={Math.max(2.1, strokeWidth * 1.12)} />
      <span className="release-readiness-icon__checks">
        <IconCheckbox size={checkSize} stroke={Math.max(1.6, strokeWidth * 0.9)} />
      </span>
    </span>
  );
}

export function UsersIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <path d="M16 20a4 4 0 0 0-8 0" />
      <circle cx="12" cy="11" r="3" />
      <path d="M20 20a3.5 3.5 0 0 0-3-3.4" />
      <path d="M7 16.6A3.5 3.5 0 0 0 4 20" />
    </IconFrame>
  );
}

export function PlugIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <path d="M9 3v6" />
      <path d="M15 3v6" />
      <path d="M7 9h10v2a5 5 0 0 1-5 5 5 5 0 0 1-5-5z" />
      <path d="M12 16v5" />
    </IconFrame>
  );
}

export function MailIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <rect height="14" rx="2" width="18" x="3" y="5" />
      <path d="m4 7 8 6 8-6" />
    </IconFrame>
  );
}

export function MessageIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6A2.5 2.5 0 0 1 16.5 15H11l-4 4v-4H7.5A2.5 2.5 0 0 1 5 12.5z" />
    </IconFrame>
  );
}

export function BugIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <path d="M8 7.5V7a4 4 0 0 1 8 0v.5" />
      <rect height="12" rx="5" width="10" x="7" y="7.5" />
      <path d="M12 11v8" />
      <path d="m8.5 4-2-2" />
      <path d="m15.5 4 2-2" />
      <path d="M4 12h3" />
      <path d="M17 12h3" />
      <path d="m5 17 2.4-1.2" />
      <path d="m18.6 15.8 2.4 1.2" />
      <path d="m5 7.5 2.3 1.2" />
      <path d="m16.7 8.7 2.3-1.2" />
    </IconFrame>
  );
}

export function PlayIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <path d="m8 6 10 6-10 6z" />
    </IconFrame>
  );
}

export function RecordIcon({ size = 16, strokeWidth = 1.9 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      <circle cx="12" cy="12" r="9" stroke="#ef0000" strokeWidth={strokeWidth} />
      <circle cx="12" cy="12" fill="#ef0000" r="6.1" stroke="none" />
    </svg>
  );
}

export function PauseIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <rect height="12" rx="1" width="4" x="7" y="6" />
      <rect height="12" rx="1" width="4" x="13" y="6" />
    </IconFrame>
  );
}

export function MoreHorizontalIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <circle cx="5" cy="12" fill="currentColor" r="1.3" stroke="none" />
      <circle cx="12" cy="12" fill="currentColor" r="1.3" stroke="none" />
      <circle cx="19" cy="12" fill="currentColor" r="1.3" stroke="none" />
    </IconFrame>
  );
}

export function MousePointerIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <path d="m5 3 14 9-6.3 1.2 3.5 6.1-3.1 1.8-3.5-6.1L5 19z" />
    </IconFrame>
  );
}

export function CalendarIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <rect height="15" rx="2" width="18" x="3" y="5" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
      <path d="M3 10h18" />
    </IconFrame>
  );
}

export function LayersIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <path d="m12 4 8 4-8 4-8-4z" />
      <path d="m4 12 8 4 8-4" />
      <path d="m4 16 8 4 8-4" />
    </IconFrame>
  );
}

export function GridIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <rect height="6" rx="1.25" width="6" x="4" y="4" />
      <rect height="6" rx="1.25" width="6" x="14" y="4" />
      <rect height="6" rx="1.25" width="6" x="4" y="14" />
      <rect height="6" rx="1.25" width="6" x="14" y="14" />
    </IconFrame>
  );
}

export function ListIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <path d="M9 7h10" />
      <path d="M9 12h10" />
      <path d="M9 17h10" />
      <circle cx="5" cy="7" r="1" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="5" cy="17" r="1" fill="currentColor" stroke="none" />
    </IconFrame>
  );
}

export function ColumnsIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <rect height="14" rx="2" width="16" x="4" y="5" />
      <path d="M10 5v14" />
      <path d="M16 5v14" />
    </IconFrame>
  );
}

export function PinIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <path d="M9 4h6" />
      <path d="M10 4v4.5L7 12h10l-3-3.5V4" />
      <path d="M12 12v8" />
    </IconFrame>
  );
}

export function SyncIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <path d="M20 7v5h-5" />
      <path d="M4 17v-5h5" />
      <path d="M7.5 8.5A7 7 0 0 1 20 12" />
      <path d="M16.5 15.5A7 7 0 0 1 4 12" />
    </IconFrame>
  );
}

export function ArchiveIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <rect x="4" y="5" width="16" height="5" rx="1.5" />
      <path d="M6 10v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8" />
      <path d="M10 14h4" />
    </IconFrame>
  );
}

export function ActivityIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <path d="M4 12h3l2.2-5 4.3 10 2.1-5H20" />
    </IconFrame>
  );
}

export function GoogleDriveIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <path d="M10 4h4l5 8-2 3h-4l-3-5Z" />
      <path d="M10 4 5 12l2 3h6" />
      <path d="M7 15H5l5 5h4l3-5" />
    </IconFrame>
  );
}

export function GithubIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <path d="M9.2 18.5c-3.5 1-3.5-2-5-2.5" />
      <path d="M14.8 18.5v-3a2.6 2.6 0 0 0-.7-2c2.2-.2 4.5-1.1 4.5-4.9a3.8 3.8 0 0 0-1-2.7 3.5 3.5 0 0 0-.1-2.7s-.9-.3-2.9 1a10.1 10.1 0 0 0-5.2 0c-2-1.3-2.9-1-2.9-1a3.5 3.5 0 0 0-.1 2.7 3.8 3.8 0 0 0-1 2.7c0 3.8 2.3 4.7 4.5 4.9a2.6 2.6 0 0 0-.7 2v3" />
    </IconFrame>
  );
}

export function MoreIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <circle cx="12" cy="6" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="18" r="1.5" />
    </IconFrame>
  );
}

export function DragHandleIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <circle cx="9" cy="8" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="8" r="1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="16" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="16" r="1" fill="currentColor" stroke="none" />
    </IconFrame>
  );
}

export function CopyIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <rect height="11" rx="2" width="11" x="9" y="9" />
      <path d="M15 9V7A2 2 0 0 0 13 5H7A2 2 0 0 0 5 7v6a2 2 0 0 0 2 2h2" />
    </IconFrame>
  );
}

export function PencilIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <path d="m15.5 5.5 3 3" />
      <path d="M4 20h4l10.5-10.5a2.12 2.12 0 0 0-3-3L5 17z" />
    </IconFrame>
  );
}

export function TrashIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <path d="M5 7h14" />
      <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" />
      <path d="m7.5 7 .8 11.1A1.5 1.5 0 0 0 9.8 19.5h4.4a1.5 1.5 0 0 0 1.5-1.4L16.5 7" />
      <path d="M10 10.5v5" />
      <path d="M14 10.5v5" />
    </IconFrame>
  );
}

export function ExportIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <path d="M12 4v12" />
      <path d="m7 9 5-5 5 5" />
      <path d="M5 20h14" />
    </IconFrame>
  );
}

export function OpenIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <path d="M14 5h5v5" />
      <path d="M10 14 19 5" />
      <path d="M19 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4" />
    </IconFrame>
  );
}

export function EyeIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.75" />
    </IconFrame>
  );
}

export function MoveIcon({ size, strokeWidth }: IconProps) {
  return (
    <IconFrame size={size} strokeWidth={strokeWidth}>
      <path d="m7 7 5-4 5 4" />
      <path d="m7 17 5 4 5-4" />
      <path d="m17 7 4 5-4 5" />
      <path d="m7 7-4 5 4 5" />
      <path d="M12 3v18" />
      <path d="M3 12h18" />
    </IconFrame>
  );
}

export function TestRunsResultsIcon({size=20}: IconProps) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 4.1a1.5 1.5 0 0 1 2.25-1.3l13 7.9a1.5 1.5 0 0 1 0 2.6l-13 7.9A1.5 1.5 0 0 1 5 19.9Z"/></svg>;
}
/** Reference clipboard, pencil and clock, enlarged without the outer frame. */
export function TestPlanIcon({ size = 24, strokeWidth = 2.6 }: IconProps) {
  const clockMaskId = useId();
  return (
    <IconFrame size={size} strokeWidth={strokeWidth} viewBox="12 11 40 40">
      <defs>
        <mask id={clockMaskId} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64" stroke="none">
          <rect width="64" height="64" fill="white" />
          <circle cx="23" cy="45" r="5.5" fill="black" />
        </mask>
      </defs>
      <g mask={`url(#${clockMaskId})`}>
        <path d="M30.5 18.5h-6v31h21.5v-31h-6M26.5 18.5V47h17V18.5" />
        <path d="m28.5 26 1.5 1.5 2-2.5m-3.5 8 1.5 1.5 2-2.5m-3.5 8 1.5 1.5 2-2.5M33 27h9m-9 7h9m-9 7h9" />
      </g>
      <path d="M30.5 16.5h3v-1.7a1.4 1.4 0 0 1 2.8 0v1.7h3v4h-8.8Z" />
      <path d="M33.5 16.5v.5a1.4 1.4 0 0 0 2.8 0v-.5" />
      <path d="M18 33V18a2 2 0 0 1 4 0v15l-2 4ZM18 18.5h4M18 33h4" />
      <circle cx="23" cy="45" r="4.8" />
      <path d="M23 43v2l1.8 1.8" />
    </IconFrame>
  );
}
export function ProjectOverviewIcon({size=20}: IconProps) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M2 2h20v15H2ZM2 5h20M12 17v5m-5 0 5-5 5 5"/><path d="M8 7v4h4a4 4 0 1 1-4-4ZM15 8h4m-4 3h4m-4 3 1 1 3-3"/></svg>;
}

function StudioReferenceAgent({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle cx="8" cy="-4" r="2" />
      <path d="M8-2v2M0 4h-1a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h1m16-6h1a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-1" />
      <rect width="16" height="12" rx="5" />
      <circle cx="5" cy="5" r=".9" fill="currentColor" stroke="none" />
      <circle cx="11" cy="5" r=".9" fill="currentColor" stroke="none" />
      <path d="M5 9h6M-1 18a9 6 0 0 1 18 0Z" />
    </g>
  );
}

/** The three-agent triangle from the supplied illustration, without its text. */
export function AiAgentStudioIcon({ size = 24, strokeWidth = 3 }: IconProps) {
  const triangleMaskId = useId();
  return (
    <IconFrame size={size} strokeWidth={strokeWidth} viewBox="0 0 64 64">
      <defs>
        <mask id={triangleMaskId} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64" stroke="none">
          <rect width="64" height="64" fill="white" />
          <g fill="black">
            <rect x="24" y="9" width="16" height="12" rx="5" />
            <rect x="4" y="39" width="16" height="12" rx="5" />
            <rect x="44" y="39" width="16" height="12" rx="5" />
            <path d="M23 27a9 6 0 0 1 18 0ZM3 57a9 6 0 0 1 18 0Zm40 0a9 6 0 0 1 18 0Z" />
          </g>
        </mask>
      </defs>
      <path d="M32 21 12 46h40Z" mask={`url(#${triangleMaskId})`} />
      <StudioReferenceAgent x={24} y={9} />
      <StudioReferenceAgent x={4} y={39} />
      <StudioReferenceAgent x={44} y={39} />
    </IconFrame>
  );
}

/** Full reference composition: clockwise arrow, four-line document and pencil. */
export function TestAutomationIcon({ size = 24, strokeWidth = 3.8 }: IconProps) {
  const pencilMaskId = useId();
  const pencilOutline = "M27 44l4.5-8.5L54.5 15a4.5 4.5 0 0 1 6.5 6.5L36 42Z";
  return (
    <IconFrame size={size} strokeWidth={strokeWidth} viewBox="0 0 64 64">
      <defs>
        <mask id={pencilMaskId} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
          <rect width="64" height="64" fill="white" stroke="none" />
          <path d={pencilOutline} fill="black" stroke="black" strokeWidth="3.5" />
        </mask>
      </defs>
      <path d="M54 39A26 26 0 1 1 35 8" />
      <path d="M35 3l7 7-9 3Z" fill="currentColor" stroke="none" />
      <g mask={`url(#${pencilMaskId})`}>
        <rect x="16.5" y="19" width="26" height="30.5" rx=".5" />
        <path d="M21 24h9m-9 4h15m-15 4h13m-13 4h12" strokeWidth="3" strokeLinecap="butt" />
      </g>
      <path d={pencilOutline} />
      <path d="m31.5 35.5 4.5 6.5M51 18l6.5 6.5m-7.8-5.3 6.5 6.5" strokeWidth="2.2" />
    </IconFrame>
  );
}

export function DatabaseConfigurationIcon({size=20}: IconProps) {
 return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 26 26" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
  <ellipse cx="9" cy="5" rx="7" ry="3"/><path d="M2 5v12c0 2 3 3 7 3m7-15v4M2 10c0 2 3 3 7 3h2M2 15c0 2 3 3 7 3"/>
  <path d="m16 11 3 0 .5 2 1.5 1 1.5-.5 1 2-1.5 1v2l1.5 1-1 2-1.5-.5-1.5 1-.5 2h-3l-.5-2-1.5-1-1.5.5-1-2 1.5-1v-2l-1.5-1 1-2 1.5.5 1.5-1Z"/><circle cx="17.5" cy="17.5" r="2.5"/>
 </svg>;
}

/** Head and connected processor from the supplied AI knowledge illustration. */
export function AiKnowledgeBaseIcon({ size = 24, strokeWidth = 2.3 }: IconProps) {
  return <IconFrame size={size} strokeWidth={strokeWidth} viewBox="0 0 48 48">
    <path d="M16 8C8 11 6 18 6 24l-4 7h4v7a3 3 0 0 0 3 3h6v5h19v-6c5-4 8-9 9-15M15 41h8a3 3 0 0 0 3-3" />
    <rect x="18" y="18" width="12" height="12" rx="2" />
    <path d="M21 21h6v4h-3v2h-3v-3M18 21h-4m4 4h-5m5 4h-3m6 1v4m5-4v5M22 18v-7l-3-3V5m8 13v-5m0-3V8l5-5M18 18v-4h-3m15 7h5m-5 6h5l4-4m-8 9h5l5-5m-9 6v4m1-23 4 3h4m-5-5-2-3" />
    <g fill="none"><circle cx="19" cy="3" r="1.8" /><circle cx="33" cy="2.5" r="1.8" /><circle cx="27" cy="11" r="1.8" /><circle cx="13" cy="14" r="1.8" /><circle cx="37" cy="8" r="1.8" /><circle cx="43" cy="17" r="1.8" /><circle cx="37" cy="21" r="1.8" /><circle cx="37" cy="27" r="1.8" /><circle cx="44" cy="25" r="1.8" /><circle cx="32" cy="39" r="1.8" /></g>
  </IconFrame>;
}
