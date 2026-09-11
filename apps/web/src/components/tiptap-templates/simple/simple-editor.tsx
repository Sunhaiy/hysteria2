"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  EditorContent,
  EditorContext,
  type JSONContent,
  useEditor,
} from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Image } from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TextAlign } from "@tiptap/extension-text-align";
import { Typography } from "@tiptap/extension-typography";
import { Highlight } from "@tiptap/extension-highlight";
import { Subscript } from "@tiptap/extension-subscript";
import { Superscript } from "@tiptap/extension-superscript";
import { FindAndReplace } from "@tiptap/extension-find-and-replace";
import { Placeholder, Selection } from "@tiptap/extensions";
import { Button } from "@/components/tiptap-ui-primitive/button";
import { Spacer } from "@/components/tiptap-ui-primitive/spacer";
import {
  Toolbar,
  ToolbarGroup,
  ToolbarSeparator,
} from "@/components/tiptap-ui-primitive/toolbar";
import {
  ImageUploadNode,
  type UploadFunction,
} from "@/components/tiptap-node/image-upload-node/image-upload-node-extension";
import { HorizontalRule } from "@/components/tiptap-node/horizontal-rule-node/horizontal-rule-node-extension";
import "@/components/tiptap-node/blockquote-node/blockquote-node.scss";
import "@/components/tiptap-node/code-block-node/code-block-node.scss";
import "@/components/tiptap-node/horizontal-rule-node/horizontal-rule-node.scss";
import "@/components/tiptap-node/list-node/list-node.scss";
import "@/components/tiptap-node/image-node/image-node.scss";
import "@/components/tiptap-node/heading-node/heading-node.scss";
import "@/components/tiptap-node/paragraph-node/paragraph-node.scss";
import { HeadingDropdownMenu } from "@/components/tiptap-ui/heading-dropdown-menu";
import { ImageUploadButton } from "@/components/tiptap-ui/image-upload-button";
import { ListDropdownMenu } from "@/components/tiptap-ui/list-dropdown-menu";
import { BlockquoteButton } from "@/components/tiptap-ui/blockquote-button";
import { CodeBlockButton } from "@/components/tiptap-ui/code-block-button";
import {
  ColorHighlightPopover,
  ColorHighlightPopoverContent,
  ColorHighlightPopoverButton,
} from "@/components/tiptap-ui/color-highlight-popover";
import {
  LinkPopover,
  LinkContent,
  LinkButton,
} from "@/components/tiptap-ui/link-popover";
import { MarkButton } from "@/components/tiptap-ui/mark-button";
import { TextAlignButton } from "@/components/tiptap-ui/text-align-button";
import { UndoRedoButton } from "@/components/tiptap-ui/undo-redo-button";
import {
  SearchAndReplace,
  SearchAndReplaceButton,
} from "@/components/tiptap-ui/search-and-replace";
import { ArrowLeftIcon } from "@/components/tiptap-icons/arrow-left-icon";
import { HighlighterIcon } from "@/components/tiptap-icons/highlighter-icon";
import { LinkIcon } from "@/components/tiptap-icons/link-icon";
import { useIsBreakpoint } from "@/hooks/use-is-breakpoint";
import { useWindowSize } from "@/hooks/use-window-size";
import { useCursorVisibility } from "@/hooks/use-cursor-visibility";
import { MAX_FILE_SIZE } from "@/lib/tiptap-utils";
import "@/components/tiptap-templates/simple/simple-editor.scss";

const SEARCH_SCROLL_OPTIONS: ScrollIntoViewOptions = { block: "center" };
const EMPTY_DOCUMENT: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

type SimpleEditorProps = {
  content?: JSONContent;
  documentKey?: string;
  readOnly?: boolean;
  onChange?: (content: JSONContent) => void;
  uploadImage?: UploadFunction;
  onUploadError?: (error: Error) => void;
  placeholder?: string;
  ariaLabel?: string;
};

function MainToolbarContent({
  onHighlighterClick,
  onLinkClick,
  onSearchClick,
  searchOpen,
  searchButtonRef,
  isMobile,
}: {
  onHighlighterClick: () => void;
  onLinkClick: () => void;
  onSearchClick: () => void;
  searchOpen: boolean;
  searchButtonRef: React.RefObject<HTMLButtonElement | null>;
  isMobile: boolean;
}) {
  return (
    <>
      <Spacer />
      <ToolbarGroup>
        <UndoRedoButton action="undo" />
        <UndoRedoButton action="redo" />
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarGroup>
        <HeadingDropdownMenu modal={false} levels={[2, 3, 4]} />
        <ListDropdownMenu
          modal={false}
          types={["bulletList", "orderedList", "taskList"]}
        />
        <BlockquoteButton />
        <CodeBlockButton />
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarGroup>
        <MarkButton type="bold" />
        <MarkButton type="italic" />
        <MarkButton type="strike" />
        <MarkButton type="code" />
        <MarkButton type="underline" />
        {isMobile ? (
          <ColorHighlightPopoverButton onClick={onHighlighterClick} />
        ) : (
          <ColorHighlightPopover />
        )}
        {isMobile ? <LinkButton onClick={onLinkClick} /> : <LinkPopover />}
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarGroup>
        <MarkButton type="superscript" />
        <MarkButton type="subscript" />
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarGroup>
        <TextAlignButton align="left" />
        <TextAlignButton align="center" />
        <TextAlignButton align="right" />
        <TextAlignButton align="justify" />
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarGroup>
        <ImageUploadButton text="图片" />
      </ToolbarGroup>
      <Spacer />
      {isMobile ? <ToolbarSeparator /> : null}
      <ToolbarGroup>
        <SearchAndReplaceButton
          ref={searchButtonRef}
          aria-expanded={searchOpen}
          data-active-state={searchOpen ? "on" : "off"}
          onClick={onSearchClick}
        />
      </ToolbarGroup>
    </>
  );
}

function MobileToolbarContent({
  type,
  onBack,
}: {
  type: "highlighter" | "link";
  onBack: () => void;
}) {
  return (
    <>
      <ToolbarGroup>
        <Button variant="ghost" onClick={onBack} aria-label="返回编辑工具">
          <ArrowLeftIcon className="tiptap-button-icon" />
          {type === "highlighter" ? (
            <HighlighterIcon className="tiptap-button-icon" />
          ) : (
            <LinkIcon className="tiptap-button-icon" />
          )}
        </Button>
      </ToolbarGroup>
      <ToolbarSeparator />
      {type === "highlighter" ? (
        <ColorHighlightPopoverContent />
      ) : (
        <LinkContent />
      )}
    </>
  );
}

export function SimpleEditor({
  content = EMPTY_DOCUMENT,
  documentKey = "new",
  readOnly = false,
  onChange,
  uploadImage,
  onUploadError,
  placeholder = "开始撰写文章正文",
  ariaLabel = "文章正文编辑区",
}: SimpleEditorProps) {
  const isMobile = useIsBreakpoint();
  const { height } = useWindowSize();
  const [mobileView, setMobileView] = useState<"main" | "highlighter" | "link">(
    "main",
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const onChangeRef = useRef(onChange);
  const uploadImageRef = useRef(uploadImage);
  const uploadErrorRef = useRef(onUploadError);
  const contentRef = useRef(content);

  useEffect(() => {
    contentRef.current = content;
    onChangeRef.current = onChange;
    uploadImageRef.current = uploadImage;
    uploadErrorRef.current = onUploadError;
  }, [content, onChange, onUploadError, uploadImage]);

  const editor = useEditor({
    immediatelyRender: false,
    editable: !readOnly,
    editorProps: {
      attributes: {
        autocomplete: "off",
        autocorrect: "off",
        autocapitalize: "off",
        "aria-label": ariaLabel,
        class: "simple-editor",
      },
    },
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
        horizontalRule: false,
        link: { openOnClick: false, enableClickSelection: true },
      }),
      HorizontalRule,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight.configure({ multicolor: true }),
      Image,
      Typography,
      Superscript,
      Subscript,
      Selection,
      Placeholder.configure({ placeholder }),
      FindAndReplace.configure({ searchDebounceMs: 500, injectCSS: false }),
      ImageUploadNode.configure({
        accept: "image/*",
        maxSize: MAX_FILE_SIZE,
        limit: 3,
        upload: (file, onProgress, abortSignal) => {
          if (!uploadImageRef.current) {
            return Promise.reject(new Error("图片上传尚未配置"));
          }
          return uploadImageRef.current(file, onProgress, abortSignal);
        },
        onError: (error) => uploadErrorRef.current?.(error),
      }),
    ],
    content,
    onUpdate: ({ editor: activeEditor }) => {
      onChangeRef.current?.(activeEditor.getJSON());
    },
  });

  const rect = useCursorVisibility({
    editor,
    overlayHeight: toolbarRef.current?.getBoundingClientRect().height ?? 0,
  });

  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);

  useEffect(() => {
    if (!editor) return;
    editor.commands.setContent(contentRef.current, { emitUpdate: false });
  }, [documentKey, editor]);

  useEffect(() => {
    if (!isMobile && mobileView !== "main") setMobileView("main");
  }, [isMobile, mobileView]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    searchButtonRef.current?.focus();
  }, []);

  const toggleSearch = useCallback(() => {
    setMobileView("main");
    setSearchOpen((open) => !open);
  }, []);

  return (
    <div className="seo-editor-scope simple-editor-wrapper">
      <EditorContext.Provider value={{ editor }}>
        {!readOnly ? (
          <Toolbar
            ref={toolbarRef}
            style={
              isMobile
                ? { bottom: `calc(100% - ${height - rect.y}px)` }
                : undefined
            }
          >
            {mobileView === "main" ? (
              <MainToolbarContent
                onHighlighterClick={() => setMobileView("highlighter")}
                onLinkClick={() => setMobileView("link")}
                onSearchClick={toggleSearch}
                searchOpen={searchOpen}
                searchButtonRef={searchButtonRef}
                isMobile={isMobile}
              />
            ) : (
              <MobileToolbarContent
                type={mobileView === "highlighter" ? "highlighter" : "link"}
                onBack={() => setMobileView("main")}
              />
            )}
          </Toolbar>
        ) : null}
        {!readOnly ? (
          <SearchAndReplace
            className="simple-editor-search-and-replace"
            open={searchOpen}
            onOpen={() => setSearchOpen(true)}
            onClose={closeSearch}
            scrollIntoViewOptions={SEARCH_SCROLL_OPTIONS}
          />
        ) : null}
        <EditorContent
          editor={editor}
          role="presentation"
          className="simple-editor-content"
        />
      </EditorContext.Provider>
    </div>
  );
}
