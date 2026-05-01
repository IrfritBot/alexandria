"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type FieldName = "name" | "slug" | "contextDescription" | "form";

type Errors = Partial<Record<FieldName, string>>;

function getErrorMessage(error: string, field?: FieldName) {
  if (error === "slug_taken") {
    return { field: "slug" as const, message: "Slug is already taken." };
  }

  if (error === "invalid_input" && field && field !== "form") {
    return { field, message: "Check this field." };
  }

  return {
    field: "form" as const,
    message: "Unable to create workspace.",
  };
}

export default function NewWorkspacePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [contextDescription, setContextDescription] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    setSubmitting(true);

    const response = await fetch("/api/workspaces", {
      body: JSON.stringify({
        contextDescription,
        name,
        slug,
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    });

    if (response.ok) {
      router.push("/");
      return;
    }

    const body = (await response.json()) as {
      error?: string;
      field?: FieldName;
    };
    const { field, message } = getErrorMessage(
      body.error ?? "workspace_creation_failed",
      body.field,
    );

    setErrors({ [field]: message });
    setSubmitting(false);
  }

  return (
    <main>
      <section aria-labelledby="workspace-title">
        <h1 id="workspace-title">Create workspace</h1>
        <form onSubmit={handleSubmit}>
          {errors.form ? <p role="alert">{errors.form}</p> : null}
          <label htmlFor="name">Name</label>
          <input
            id="name"
            name="name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          {errors.name ? <p role="alert">{errors.name}</p> : null}

          <label htmlFor="slug">Slug</label>
          <input
            id="slug"
            name="slug"
            required
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            minLength={3}
            maxLength={63}
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
          />
          {errors.slug ? <p role="alert">{errors.slug}</p> : null}

          <label htmlFor="contextDescription">Context description</label>
          <textarea
            id="contextDescription"
            name="contextDescription"
            required
            minLength={30}
            value={contextDescription}
            onChange={(event) => setContextDescription(event.target.value)}
          />
          {errors.contextDescription ? (
            <p role="alert">{errors.contextDescription}</p>
          ) : null}

          <button type="submit" disabled={submitting}>
            Create workspace
          </button>
        </form>
      </section>
    </main>
  );
}
