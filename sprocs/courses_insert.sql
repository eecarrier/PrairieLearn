CREATE OR REPLACE FUNCTION
    courses_insert(
        short_name text,
        title text,
        display_timezone text,
        path text,
        repository text,
        authn_user_id bigint
    ) returns void
AS $$
DECLARE
    new_row pl_courses%ROWTYPE;
BEGIN
    BEGIN
        INSERT INTO pl_courses AS c
            (short_name, title, display_timezone, path, repository)
        VALUES
            (short_name, title, display_timezone, path, repository)
        RETURNING
            c.* INTO new_row;
    EXCEPTION
        WHEN unique_violation THEN RAISE EXCEPTION 'course already exists';
    END;

    INSERT INTO audit_logs
        (authn_user_id, table_name,
        row_id,      action,  new_state)
    VALUES
        (authn_user_id, 'pl_courses',
        new_row.id, 'insert', to_jsonb(new_row));
END;
$$ LANGUAGE plpgsql VOLATILE;
