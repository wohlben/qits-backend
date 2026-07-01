-- Agent launches embed their prompt directly in the command line (no side prompt file), so a
-- command's rendered script can be long — widen execute_script from varchar(4000) to a CLOB.
alter table command alter column execute_script set data type clob;
